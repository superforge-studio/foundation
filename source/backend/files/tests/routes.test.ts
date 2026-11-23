import { eq } from "drizzle-orm"
import { beforeEach, expect, test, vi } from "vitest"
import { z } from "zod"
import { fileRoutes } from "@/backend/files/routes"
import { testApi } from "@/backend/tests/support/api"
import { logInAs } from "@/backend/tests/support/login"
import { file_folders, files } from "@/database/schema"
import { Storage } from "@/database/storage"
import { memoryStore } from "@/database/tests/support/storage"
import { fromNow } from "@/database/time"
import { DAY } from "@/utilities/primitives/durations"
import { api_failure } from "@/utilities/schemas/failures"

// Your files, through the whole API: open, in
// folders kept in Postgres with their bytes in the bucket, and the folders
// the app keeps for itself, which can be looked in and never changed

beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {})
})

// The API, with an internal person logged in, and their headers. With
// `presigns: false`, the bucket can't sign, as a dev server's folder can't
async function asOwner(options: { presigns?: boolean } = {}) {
    const memory = memoryStore(options)
    const api = await testApi({ storage: new Storage(memory.store) })
    const owner = await logInAs(api, "ada@example.com")
    return {
        api,
        memory,
        owner,
        headers: { headers: { cookie: owner.cookie } }
    }
}

type LoggedIn = Awaited<ReturnType<typeof asOwner>>

// A new folder, in `parent_id` or at the top, by its ID
async function makeFolder(
    { api, headers }: LoggedIn,
    name: string,
    parent_id: string | null = null
) {
    const made = await api.client.api.files.folders.$post(
        { json: { name, parent_id } },
        headers
    )
    if (made.status !== 201) {
        throw new Error(`The folder wasn't made: ${made.status}`)
    }
    return (await made.json()).id
}

// A file uploaded the way a browser does it, to the bucket, by its ID
async function upload(
    logged_in: LoggedIn,
    name: string,
    body: string,
    folder_id: string | null = null,
    content_type = "text/plain"
) {
    const { api, memory, headers } = logged_in
    const started = await api.client.api.files.uploads.$post(
        {
            json: {
                folder_id,
                name,
                content_type,
                size: new TextEncoder().encode(body).length
            }
        },
        headers
    )
    if (started.status !== 201) {
        throw new Error(`The upload didn't start: ${started.status}`)
    }
    const { id, upload: target } = await started.json()
    if (target.method === "POST") {
        // What the bucket keeps once the browser posts the form
        await memory.store.put(`files/${id}`, body, content_type)
    } else {
        // From the dashboard's own page, as a browser says it is
        const sent = await api.api.request(target.url, {
            method: "PUT",
            body,
            headers: {
                ...headers.headers,
                origin: "http://localhost",
                "content-type": content_type
            }
        })
        expect(sent.status).toBe(200)
    }
    const done = await api.client.api.files.uploads[":file_id"].done.$post(
        { param: { file_id: id } },
        headers
    )
    expect(done.status).toBe(200)
    return id
}

// What's in a folder, or at the top
async function contents({ api, headers }: LoggedIn, folder_id = "root") {
    const listed = await api.client.api.files.folders[":folder_id"].$get(
        { param: { folder_id } },
        headers
    )
    if (listed.status !== 200) {
        throw new Error(`The folder didn't list: ${listed.status}`)
    }
    return await listed.json()
}

test("only a role that reaches Files sees it, and only one that may write changes it", async () => {
    const api = await testApi({
        access: {
            internal_users: [],
            roles: {
                owner: "everything",
                member: { files: "read" }
            }
        }
    })
    const logged_out = await api.client.api.files.kinds.$get()
    expect(logged_out.status).toBe(401)

    const member = await logInAs(api, "maria@example.com", "member")
    const headers = { headers: { cookie: member.cookie } }
    const listed = await api.client.api.files.folders[":folder_id"].$get(
        { param: { folder_id: "root" } },
        headers
    )
    expect(listed.status).toBe(200)
    const refused = await api.client.api.files.folders.$post(
        { json: { name: "Receipts", parent_id: null } },
        headers
    )
    expect(refused.status).toBe(403)
    expect(api_failure.parse(await refused.json()).error.reason).toBe(
        "not-permitted"
    )
})

test("the top of the bucket is each kind as its code says, and the folders none claims", async () => {
    const logged_in = await asOwner()
    await logged_in.memory.store.put("old-uploads/a.txt", "a", "text/plain")
    await logged_in.memory.store.put(
        "visitor-salt/today.json",
        "{}",
        "application/json"
    )

    const top = await logged_in.api.client.api.files.kinds.$get(
        {},
        logged_in.headers
    )
    expect(top.status).toBe(200)
    if (top.status === 200) {
        const { kinds, unclaimed } = await top.json()
        expect(kinds.map((kind) => [kind.folder, kind.access])).toEqual([
            ["files", "open"],
            // The server's own, which counts visitors the site doesn't
            // remember (backend/visits/visitors.ts)
            ["visitor-salt", "locked"]
        ])
        expect(kinds[1]).toEqual(
            expect.objectContaining({
                name: "Visitor salt",
                why: expect.stringContaining("each day")
            })
        )
        expect(unclaimed).toEqual(["old-uploads"])
    }
})

test("folders hold folders and files, renamed and moved as rows", async () => {
    const logged_in = await asOwner()
    const contracts = await makeFolder(logged_in, "Contracts")
    const signed_ones = await makeFolder(logged_in, "Signed", contracts)
    const lease = await upload(logged_in, "Truck lease.txt", "Lease", contracts)

    expect(z.uuid().safeParse(contracts).success).toBe(true)
    expect(z.uuid().safeParse(lease).success).toBe(true)
    const top = await contents(logged_in)
    expect(top.path).toEqual([])
    expect(top.folders).toEqual([
        expect.objectContaining({ id: contracts, name: "Contracts", items: 2 })
    ])
    const inside = await contents(logged_in, contracts)
    expect(inside.path).toEqual([{ id: contracts, name: "Contracts" }])
    expect(inside.folders.map((folder) => folder.name)).toEqual(["Signed"])
    expect(inside.files).toEqual([
        expect.objectContaining({
            id: lease,
            name: "Truck lease.txt",
            content_type: "text/plain",
            size: 5,
            uploaded_by: "Ada Example"
        })
    ])

    // Renamed and moved: the bytes stay under the file's ID
    const moved = await logged_in.api.client.api.files[":file_id"].$patch(
        {
            param: { file_id: lease },
            json: { name: "Lease 2026.txt", folder_id: signed_ones }
        },
        logged_in.headers
    )
    expect(moved.status).toBe(200)
    expect((await contents(logged_in, signed_ones)).files[0]?.name).toBe(
        "Lease 2026.txt"
    )
    expect(logged_in.memory.files.has(`files/${lease}`)).toBe(true)

    // A folder can't go inside itself
    const looped = await logged_in.api.client.api.files.folders[
        ":folder_id"
    ].$patch(
        { param: { folder_id: contracts }, json: { parent_id: signed_ones } },
        logged_in.headers
    )
    expect(looped.status).toBe(409)
    expect(api_failure.parse(await looped.json()).error.reason).toBe(
        "into-itself"
    )
})

test("an upload shows only once its bytes are in, and no larger than it said", async () => {
    const logged_in = await asOwner()
    const started = await logged_in.api.client.api.files.uploads.$post(
        {
            json: {
                folder_id: null,
                name: "Quote.pdf",
                content_type: "application/pdf",
                size: 4
            }
        },
        logged_in.headers
    )
    expect(started.status).toBe(201)
    if (started.status !== 201) {
        return
    }
    const { id, upload: target } = await started.json()
    // The browser posts straight to the bucket, on a form for this file
    expect(target).toEqual({
        method: "POST",
        url: "https://bucket.test/",
        fields: expect.objectContaining({
            key: `files/${id}`,
            "Content-Type": "application/pdf",
            max_bytes: "4"
        })
    })
    expect((await contents(logged_in)).files).toEqual([])

    const early = await logged_in.api.client.api.files.uploads[
        ":file_id"
    ].done.$post({ param: { file_id: id } }, logged_in.headers)
    expect(early.status).toBe(409)
    expect(api_failure.parse(await early.json()).error.reason).toBe(
        "not-uploaded"
    )

    await logged_in.memory.store.put(
        `files/${id}`,
        "%PDF-too-long",
        "application/pdf"
    )
    const large = await logged_in.api.client.api.files.uploads[
        ":file_id"
    ].done.$post({ param: { file_id: id } }, logged_in.headers)
    expect(large.status).toBe(409)
    expect(logged_in.memory.files.has(`files/${id}`)).toBe(false)
})

test("a dev server takes an upload itself and serves it, a range at a time", async () => {
    const logged_in = await asOwner({ presigns: false })
    const notes = await upload(logged_in, "Notes.txt", "0123456789")
    const logo = await upload(
        logged_in,
        "Logo.svg",
        "<svg xmlns='http://www.w3.org/2000/svg'/>",
        null,
        "image/svg+xml"
    )

    const whole = await logged_in.api.api.request(
        `/api/files/${notes}/download?inline=1`,
        logged_in.headers
    )
    expect(whole.status).toBe(200)
    expect(await whole.text()).toBe("0123456789")
    expect(whole.headers.get("content-disposition")).toMatch(/^inline;/)

    const range = await logged_in.api.api.request(
        `/api/files/${notes}/download`,
        {
            headers: { ...logged_in.headers.headers, range: "bytes=2-4" }
        }
    )
    expect(range.status).toBe(206)
    expect(await range.text()).toBe("234")
    expect(range.headers.get("content-disposition")).toMatch(/^attachment;/)

    // An SVG, which could run as the app at its address, downloads, and
    // can't run if it's opened
    const svg = await logged_in.api.api.request(
        `/api/files/${logo}/download?inline=1`,
        logged_in.headers
    )
    expect(svg.headers.get("content-disposition")).toMatch(/^attachment;/)
    expect(svg.headers.get("content-security-policy")).toContain("sandbox")

    // And it has no links to hand out
    const link = await logged_in.api.client.api.files[":file_id"].link.$post(
        { param: { file_id: notes } },
        logged_in.headers
    )
    expect(link.status).toBe(409)
})

test("a file downloads from the bucket, named, and links for a week", async () => {
    const logged_in = await asOwner()
    const lease = await upload(logged_in, "Truck lease.txt", "Lease")

    const download = await logged_in.api.api.request(
        `/api/files/${lease}/download`,
        logged_in.headers
    )
    expect(download.status).toBe(302)
    expect(download.headers.get("location")).toBe(
        `https://bucket.test/files/${lease}?expires=300&download=Truck+lease.txt`
    )
    const preview = await logged_in.api.api.request(
        `/api/files/${lease}/download?inline=1`,
        logged_in.headers
    )
    expect(preview.headers.get("location")).toBe(
        `https://bucket.test/files/${lease}?expires=300`
    )

    const link = await logged_in.api.client.api.files[":file_id"].link.$post(
        { param: { file_id: lease } },
        logged_in.headers
    )
    expect(link.status).toBe(200)
    if (link.status === 200) {
        const { url } = await link.json()
        expect(url).toBe(
            `https://bucket.test/files/${lease}?expires=604800&download=Truck+lease.txt`
        )
    }
})

test("Trash takes a folder with everything in it, brings it back, and empties after 30 days", async () => {
    const logged_in = await asOwner()
    const quotes = await makeFolder(logged_in, "Quotes")
    const quote = await upload(logged_in, "Quote.txt", "Q", quotes)
    const loose = await upload(logged_in, "Loose.txt", "L")

    const trashed = await logged_in.api.client.api.files.folders[
        ":folder_id"
    ].$delete({ param: { folder_id: quotes } }, logged_in.headers)
    expect(trashed.status).toBe(200)
    await logged_in.api.client.api.files[":file_id"].$delete(
        { param: { file_id: loose } },
        logged_in.headers
    )
    expect((await contents(logged_in)).folders).toEqual([])
    // What's inside a folder in Trash can't be reached on its own
    const inside = await logged_in.api.api.request(
        `/api/files/${quote}/download`,
        logged_in.headers
    )
    expect(inside.status).toBe(404)

    const trash = await logged_in.api.client.api.files.trash.$get(
        {},
        logged_in.headers
    )
    if (trash.status === 200) {
        const listed = await trash.json()
        expect(listed.folders.map((folder) => folder.id)).toEqual([quotes])
        expect(listed.files.map((file) => file.id)).toEqual([loose])
    }

    const restored = await logged_in.api.client.api.files.folders[
        ":folder_id"
    ].restore.$post({ param: { folder_id: quotes } }, logged_in.headers)
    expect(restored.status).toBe(200)
    expect(
        (await contents(logged_in, quotes)).files.map((file) => file.id)
    ).toEqual([quote])

    // A month on, the loose file's gone for good, its bytes first
    await logged_in.api.database
        .update(files)
        .set({ trashed_at: fromNow(-31 * DAY) })
        .where(eq(files.id, loose))
    await logged_in.api.client.api.files.trash.$get({}, logged_in.headers)
    expect(logged_in.memory.files.has(`files/${loose}`)).toBe(false)
    expect(
        await logged_in.api.database
            .select()
            .from(files)
            .where(eq(files.id, loose))
    ).toEqual([])
    expect(logged_in.memory.files.has(`files/${quote}`)).toBe(true)
})

test("a file comes back to the top when its folder went to Trash after it", async () => {
    const logged_in = await asOwner()
    const old = await makeFolder(logged_in, "Old")
    const note = await upload(logged_in, "Note.txt", "N", old)
    await logged_in.api.client.api.files[":file_id"].$delete(
        { param: { file_id: note } },
        logged_in.headers
    )
    await logged_in.api.client.api.files.folders[":folder_id"].$delete(
        { param: { folder_id: old } },
        logged_in.headers
    )

    const restored = await logged_in.api.client.api.files[
        ":file_id"
    ].restore.$post({ param: { file_id: note } }, logged_in.headers)
    expect(restored.status).toBe(200)
    if (restored.status === 200) {
        expect(await restored.json()).toEqual({ to_top: true })
    }
    expect((await contents(logged_in)).files.map((file) => file.id)).toEqual([
        note
    ])
    const [row] = await logged_in.api.database
        .select({ folder_id: files.folder_id })
        .from(files)
        .where(eq(files.id, note))
    expect(row?.folder_id).toBeNull()
    expect(
        (
            await logged_in.api.database
                .select({ trashed_at: file_folders.trashed_at })
                .from(file_folders)
                .where(eq(file_folders.id, old))
        )[0]?.trashed_at
    ).not.toBeNull()
})

test("the app's own folders can be looked in and downloaded from, by the paths their listing gives", async () => {
    const logged_in = await asOwner()
    await logged_in.memory.store.put(
        "visitor-salt/today.json",
        "{}",
        "application/json"
    )
    await logged_in.memory.store.put("old-uploads/a.txt", "a", "text/plain")

    const top = await logged_in.api.client.api.files.kept[":folder"].$get(
        { param: { folder: "visitor-salt" }, query: {} },
        logged_in.headers
    )
    expect(top.status).toBe(200)
    if (top.status === 200) {
        const listed = await top.json()
        expect(listed.kind.access).toBe("locked")
        expect(listed.folders).toEqual([])
        expect(listed.files.map((file) => file.key)).toEqual([
            "visitor-salt/today.json"
        ])
    }

    const download = await logged_in.api.api.request(
        "/api/files/kept/visitor-salt/download?path=visitor-salt/today.json",
        logged_in.headers
    )
    expect(download.status).toBe(302)
    expect(download.headers.get("location")).toBe(
        "https://bucket.test/visitor-salt/today.json?expires=300&download=today.json"
    )

    // Not another kind's path, and never Your files, which only Postgres
    // reaches
    const elsewhere = await logged_in.api.api.request(
        "/api/files/kept/visitor-salt/download?path=old-uploads/a.txt",
        logged_in.headers
    )
    expect(elsewhere.status).toBe(404)
    const yours = await logged_in.api.client.api.files.kept[":folder"].$get(
        { param: { folder: "files" }, query: {} },
        logged_in.headers
    )
    expect(yours.status).toBe(404)
})

test("no route changes anything in a folder the app keeps for itself", () => {
    // The lock is that there's no route for it: every route that changes
    // anything is under Your files' own paths
    const changing = fileRoutes.routes.filter(
        (route) => route.method !== "GET" && route.method !== "ALL"
    )
    expect(changing.length).toBeGreaterThan(0)
    for (const route of changing) {
        expect(route.path).not.toContain("/kept")
        expect(route.path).not.toContain("/kinds")
    }
})
