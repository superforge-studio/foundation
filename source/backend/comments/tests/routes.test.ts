import { expect, test, vi } from "vitest"
import type { FiledComment, Infra } from "@/backend/infra"
import { standInInfra } from "@/backend/infra"
import { testApi } from "@/backend/tests/support/api"
import { logInAs } from "@/backend/tests/support/login"
import type { PageComment } from "@/utilities/schemas/comments"
import { api_failure } from "@/utilities/schemas/failures"

// A comment from the toolbar through the whole API, to Infra's stand-in:
// only someone logged in can file one, and the server adds who they are

const COMMENT: PageComment = {
    body: "This button sits too close to the edge on a phone",
    path: "/pricing",
    title: "Pricing",
    element: {
        selector: "body > div > main > section:nth-of-type(2) > a",
        tag: "a",
        text: "Book a call",
        classes: "inline-flex rounded-md bg-primary px-4",
        box: { x: 120, y: 1640, width: 180, height: 44 }
    },
    viewport: { width: 1440, height: 900 }
}

const BROWSER =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15"

// The API, with every comment sent through the stand-in, or through
// `fileComment` in place of its own, and what it sent Infra
async function setup(fileComment?: Infra["fileComment"]) {
    const filed: FiledComment[] = []
    const stand_in = standInInfra()
    const infra: Infra = {
        ...stand_in,
        fileComment: async (comment) => {
            filed.push(comment)
            return await (fileComment ?? stand_in.fileComment)(comment)
        }
    }
    const api = await testApi({ infra })
    return { api, filed }
}

test("an internal person's comment goes to Infra with who filed it", async () => {
    const { api, filed } = await setup()
    const { id, cookie } = await logInAs(api, "ada@example.com")

    const answer = await api.client.api.comments.$post(
        { json: COMMENT },
        { headers: { cookie, "User-Agent": BROWSER } }
    )
    expect(answer.status).toBe(201)
    if (answer.status === 201) {
        const { comment } = await answer.json()
        expect(comment.id).toEqual(expect.any(String))
    }
    expect(filed).toEqual([{ ...COMMENT, user: id, user_agent: BROWSER }])
    // Never their email: Infra keeps no app's users
    expect(JSON.stringify(filed)).not.toContain("ada@example.com")
})

test("a comment on the page as a whole goes too", async () => {
    const { api, filed } = await setup()
    const { cookie } = await logInAs(api, "ada@example.com")

    const answer = await api.client.api.comments.$post(
        {
            json: {
                body: "The whole page loads slowly",
                path: "/",
                title: null,
                element: null,
                viewport: null
            }
        },
        { headers: { cookie } }
    )
    expect(answer.status).toBe(201)
    expect(filed[0]).toMatchObject({ element: null, user_agent: null })
})

test("a visitor can't file one", async () => {
    const { api, filed } = await setup()

    const answer = await api.client.api.comments.$post({ json: COMMENT })
    expect(answer.status).toBe(401)
    const { error } = api_failure.parse(await answer.json())
    expect(error.reason).toBe("logged-out")
    expect(filed).toEqual([])
})

test("an empty comment, or a page with its query, is refused before Infra", async () => {
    const { api, filed } = await setup()
    const { cookie } = await logInAs(api, "ada@example.com")

    const answer = await api.client.api.comments.$post(
        { json: { ...COMMENT, body: "   ", path: "/pricing?coupon=SECRET" } },
        { headers: { cookie } }
    )
    expect(answer.status).toBe(400)
    const { error } = api_failure.parse(await answer.json())
    expect(error.reason).toBe("invalid")
    expect(filed).toEqual([])
})

test("an Infra that's down answers 503, and one that refuses it 502", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const down = await setup(async () => ({
        ok: false,
        error: { reason: "unavailable", message: "Infra is down." }
    }))
    const logged_in = await logInAs(down.api, "ada@example.com")
    const unavailable = await down.api.client.api.comments.$post(
        { json: COMMENT },
        { headers: { cookie: logged_in.cookie } }
    )
    expect(unavailable.status).toBe(503)
    expect(api_failure.parse(await unavailable.json()).error.reason).toBe(
        "unavailable"
    )

    const refusing = await setup(async () => ({
        ok: false,
        error: {
            reason: "invalid",
            fields: ["element.selector"],
            message: "element.selector didn't fit what this call takes."
        }
    }))
    const other = await logInAs(refusing.api, "ada@example.com")
    const refused = await refusing.api.client.api.comments.$post(
        { json: COMMENT },
        { headers: { cookie: other.cookie } }
    )
    expect(refused.status).toBe(502)
    expect(api_failure.parse(await refused.json()).error.reason).toBe("refused")
})

test("the stand-in checks a comment as Infra does", async () => {
    const infra = standInInfra()
    const kept = await infra.fileComment({
        ...COMMENT,
        user: "5f0c1a2b-3d4e-4f60-8a9b-0c1d2e3f4a5b",
        user_agent: null
    })
    expect(kept.ok).toBe(true)

    const refused = await infra.fileComment({
        ...COMMENT,
        user: "ada@example.com",
        user_agent: null
    })
    expect(refused).toEqual({
        ok: false,
        error: {
            reason: "invalid",
            fields: ["user"],
            message: "user didn't fit what this call takes."
        }
    })
})
