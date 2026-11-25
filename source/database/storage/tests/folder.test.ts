import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import type { ObjectStore } from ".."
import { folderStore } from "../folder"

// What's kept under `key`, as text
async function read(storage: ObjectStore, key: string) {
    const kept = await storage.get(key)
    if (kept === null) {
        return null
    } else {
        return new TextDecoder().decode(kept)
    }
}

const made: string[] = []
afterAll(async () => {
    await Promise.all(
        made.map((directory) => rm(directory, { recursive: true }))
    )
})

async function folder() {
    const directory = await mkdtemp(join(tmpdir(), "storage-"))
    made.push(directory)
    return { storage: folderStore(directory), directory }
}

describe("a dev server's storage", () => {
    it("opens an empty file as an empty body", async () => {
        const { storage } = await folder()
        await storage.put("files/empty", new Uint8Array(), "text/plain")
        const opened = await storage.open("files/empty")
        if (!opened.ok) {
            throw new Error("The empty file didn't open")
        }
        expect(opened.data.size).toBe(0)
        expect(await new Response(opened.data.body).text()).toBe("")
    })

    it("keeps each key as a file under its folder", async () => {
        const { storage, directory } = await folder()

        await storage.put("invoices/customer-1/invoice-1", "<p>Hi</p>", "")

        expect(
            await readFile(
                join(directory, "invoices", "customer-1", "invoice-1"),
                "utf8"
            )
        ).toBe("<p>Hi</p>")
        expect(await read(storage, "invoices/customer-1/invoice-1")).toBe(
            "<p>Hi</p>"
        )
        expect(await read(storage, "invoices/customer-1/invoice-2")).toBeNull()
    })

    it("keeps a file's bytes as they came", async () => {
        const { storage, directory } = await folder()
        const bytes = new Uint8Array([0, 255, 137, 80])

        await storage.put("uploads/one/1.png", bytes, "image/png")

        expect(
            new Uint8Array(
                await readFile(join(directory, "uploads", "one", "1.png"))
            )
        ).toEqual(bytes)
    })

    it("deletes a key's file, and a key that holds nothing too", async () => {
        const { storage } = await folder()
        await storage.put("invoices/a", "<p>A</p>", "text/html")

        await storage.delete("invoices/a")
        await storage.delete("invoices/a")

        expect(await read(storage, "invoices/a")).toBeNull()
    })

    it("refuses a key that would leave its folder", async () => {
        const { storage } = await folder()

        await expect(storage.put("../outside", "", "")).rejects.toThrow(
            "A Storage key can't name a path like ../outside"
        )
    })

    it("streams a file, all of it or a range, and says when it can't", async () => {
        const { storage } = await folder()
        await storage.put("videos/a.mp4", "0123456789", "video/mp4")

        const whole = await storage.open("videos/a.mp4")
        const range = await storage.open("videos/a.mp4", { start: 2, end: 4 })

        expect(whole.ok && (await new Response(whole.data.body).text())).toBe(
            "0123456789"
        )
        expect(whole.ok && whole.data.partial).toBe(false)
        expect(range.ok && (await new Response(range.data.body).text())).toBe(
            "234"
        )
        expect(range.ok && range.data).toEqual(
            expect.objectContaining({
                size: 10,
                start: 2,
                end: 4,
                partial: true
            })
        )
        expect(await storage.open("videos/b.mp4")).toEqual({
            ok: false,
            error: "not-found"
        })
        expect(await storage.open("videos/a.mp4", { start: 10 })).toEqual({
            ok: false,
            error: "unsatisfiable"
        })
    })

    it("lists what's under a prefix, its folders and a page at a time", async () => {
        const { storage, directory } = await folder()
        await storage.put("images/door/400.webp", "door", "image/webp")
        await storage.put("images/door/800.webp", "door, wider", "image/webp")
        await storage.put("images/logo.svg", "<svg/>", "image/svg+xml")
        await storage.put("videos/tour.mp4", "tour", "video/mp4")
        // As macOS's Finder leaves in a folder it has shown
        await writeFile(join(directory, "images", ".DS_Store"), "")

        const everything = await storage.list("images/")
        const folders = await storage.list("images/", { folders: true })
        const first = await storage.list("images/", { limit: 2 })
        const second = await storage.list("images/", {
            limit: 2,
            cursor: first.cursor ?? undefined
        })

        expect(everything.files.map((file) => file.key)).toEqual([
            "images/door/400.webp",
            "images/door/800.webp",
            "images/logo.svg"
        ])
        expect(everything.files[1]).toEqual({
            key: "images/door/800.webp",
            size: 11,
            modified: expect.any(Date)
        })
        expect(everything.cursor).toBeNull()
        expect(folders).toEqual({
            files: [expect.objectContaining({ key: "images/logo.svg" })],
            folders: ["images/door/"],
            cursor: null
        })
        expect(first.files.map((file) => file.key)).toEqual([
            "images/door/400.webp",
            "images/door/800.webp"
        ])
        expect(first.cursor).toBe("images/door/800.webp")
        expect(second.files.map((file) => file.key)).toEqual([
            "images/logo.svg"
        ])
        expect(second.cursor).toBeNull()
        expect((await storage.list("")).files).toHaveLength(4)
        expect(await storage.list("nothing/")).toEqual({
            files: [],
            folders: [],
            cursor: null
        })
    })

    it("lists a folder made by hand, which no put made", async () => {
        const { storage, directory } = await folder()
        await mkdir(join(directory, "old-uploads"), { recursive: true })
        await writeFile(join(directory, "old-uploads", "a.txt"), "a")

        expect(await storage.list("", { folders: true })).toEqual({
            files: [],
            folders: ["old-uploads/"],
            cursor: null
        })
    })

    it("describes a file, its content type guessed from its name", async () => {
        const { storage } = await folder()
        await storage.put("invoices/a.pdf", "%PDF", "application/pdf")
        await storage.put("invoices/a", "bytes", "application/pdf")

        expect(await storage.head("invoices/a.pdf")).toEqual({
            size: 4,
            content_type: "application/pdf",
            modified: expect.any(Date)
        })
        expect((await storage.head("invoices/a"))?.content_type).toBe(
            "application/octet-stream"
        )
        expect(await storage.head("invoices/b.pdf")).toBeNull()
        expect(await storage.head("invoices")).toBeNull()
    })

    it("can't presign, having no bucket to sign for", async () => {
        const { storage } = await folder()

        expect(await storage.presignGet("a", { seconds: 60 })).toEqual({
            ok: false,
            error: "not-presignable"
        })
        expect(
            await storage.presignPost("a", {
                seconds: 60,
                content_type: "text/plain",
                max_bytes: 10
            })
        ).toEqual({ ok: false, error: "not-presignable" })
    })
})
