import { asc } from "drizzle-orm"
import { expect, test, vi } from "vitest"
import { makeApiToken } from "@/backend/auth/api-tokens"
import { testApi } from "@/backend/tests/support/api"
import { logInAs } from "@/backend/tests/support/login"
import { connect } from "@/database"
import { analytics_events, analytics_visits } from "@/database/schema"
import { api_failure } from "@/utilities/schemas/failures"
import type { VisitorMode } from "@/utilities/visitors"
import type { Locate } from "../location"

// The pages' events through the whole API, into a database of the test's
// own, in each of the site's modes: what's kept of the visitor, the
// cookies the server sets, renews and clears, and whether the page asks

// A batch a page sent a moment ago
function batch() {
    const now = Date.now()
    return {
        sent_at: now,
        events: [
            {
                name: "view",
                at: now - 2000,
                path: "/pricing",
                properties: { title: "Pricing" }
            }
        ]
    }
}

const KEPT_ID = "2f1c8e64-7b5a-4f2e-9c3d-8a6b1e0f4d27"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// The day's hash, which a visitor who isn't remembered is kept under
const HASH = /^[\w-]{22}$/

const IPHONE =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1"

// 400 days, in seconds: the longest Chrome keeps a cookie
const LIFETIME = 34_560_000

// The API in `mode`, with visitors placed by `locate`: nowhere, unless the
// test says
async function setup(visitor_mode: VisitorMode = "remember", locate?: Locate) {
    return await testApi({ visitor_mode, locate })
}

// Posts a batch as a page does, from a phone, with `cookie` and any other
// `headers`
async function post(
    api: Awaited<ReturnType<typeof testApi>>,
    cookie = "",
    headers: Record<string, string> = {}
) {
    return await api.client.api.visits.$post(
        { json: batch() },
        { headers: { cookie, "User-Agent": IPHONE, ...headers } }
    )
}

// The visits the API kept, oldest first
async function visits(api: Awaited<ReturnType<typeof testApi>>) {
    return await api.database
        .select()
        .from(analytics_visits)
        .orderBy(asc(analytics_visits.started_at))
}

// Each cookie a response set, by its name: the whole Set-Cookie line
function cookiesSet(response: Response) {
    return new Map(
        response.headers
            .getSetCookie()
            .map((line) => [line.slice(0, line.indexOf("=")), line])
    )
}

// The value a Set-Cookie line sets
function cookieValue(line: string | undefined) {
    return /^[^=]+=([^;]*)/.exec(line ?? "")?.[1]
}

test("in remember mode, a new visitor is remembered: a new ID, in a lasting cookie no script reads, with their visit under it", async () => {
    const api = await setup("remember")
    const response = await post(api, "", { "X-Real-IP": "203.0.113.9" })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ask: false })

    const visitor = cookiesSet(response).get("visitor")
    expect(cookieValue(visitor)).toMatch(UUID)
    expect(visitor).toMatch(/; Max-Age=34560000/)
    expect(visitor).toMatch(/; Path=\//)
    expect(visitor).toMatch(/; HttpOnly/)
    expect(visitor).toMatch(/; SameSite=Lax/)
    // Plain http on this computer, where a browser won't keep a Secure one
    expect(visitor).not.toMatch(/Secure/)
    expect(cookiesSet(response).has("visitor_consent")).toBe(false)

    expect(await visits(api)).toEqual([
        expect.objectContaining({
            visitor_id: cookieValue(visitor),
            anonymous: false,
            user_id: null,
            views: 1,
            landing_path: "/pricing",
            country: null,
            device: "mobile",
            browser: "Safari",
            os: "iOS"
        })
    ])
    expect(await api.database.select().from(analytics_events)).toEqual([
        expect.objectContaining({
            source: "browser",
            name: "view",
            path: "/pricing",
            properties: { title: "Pricing" },
            visitor_id: cookieValue(visitor)
        })
    ])
})

test("a remembered visitor keeps their ID, renewed for another 400 days with each batch", async () => {
    const api = await setup("remember")
    const response = await post(api, `visitor=${KEPT_ID}`)
    const visitor = cookiesSet(response).get("visitor")
    expect(cookieValue(visitor)).toBe(KEPT_ID)
    expect(visitor).toMatch(new RegExp(`Max-Age=${LIFETIME}`))
    expect((await visits(api)).map((visit) => visit.visitor_id)).toEqual([
        KEPT_ID
    ])
})

test("a visitor's cookie that isn't an ID is replaced with a new one", async () => {
    const api = await setup("remember")
    const response = await post(api, "visitor=not%20an%20id")
    const id = cookieValue(cookiesSet(response).get("visitor"))
    expect(id).toMatch(UUID)
    expect((await visits(api)).map((visit) => visit.visitor_id)).toEqual([id])
})

test("in remember mode, a visitor who once declined isn't remembered: their ID is cleared, and they're kept under the day's hash", async () => {
    const api = await setup("remember")
    const response = await post(
        api,
        `visitor=${KEPT_ID}; visitor_consent=declined`
    )
    expect(await response.json()).toEqual({ ask: false })
    const visitor = cookiesSet(response).get("visitor")
    expect(cookieValue(visitor)).toBe("")
    expect(visitor).toMatch(/Max-Age=0/)
    expect(await visits(api)).toEqual([
        expect.objectContaining({
            visitor_id: expect.stringMatching(HASH),
            anonymous: true
        })
    ])
})

test("in ask mode, a visitor who hasn't answered is asked, nothing is set, and they're counted for the day", async () => {
    const api = await setup("ask")
    const response = await post(api)
    expect(await response.json()).toEqual({ ask: true })
    expect(response.headers.getSetCookie()).toEqual([])

    // Their next page, the same visitor by the day's hash, in the same visit
    await post(api)
    expect(await visits(api)).toEqual([
        expect.objectContaining({
            visitor_id: expect.stringMatching(HASH),
            anonymous: true,
            views: 2
        })
    ])
})

test("in ask mode, an ID kept before the visitor was asked is cleared until they accept", async () => {
    const api = await setup("ask")
    const response = await post(api, `visitor=${KEPT_ID}`)
    expect(await response.json()).toEqual({ ask: true })
    expect(cookieValue(cookiesSet(response).get("visitor"))).toBe("")
    expect((await visits(api)).map((visit) => visit.anonymous)).toEqual([true])
})

test("in ask mode, a visitor who accepted is remembered and not asked", async () => {
    const api = await setup("ask")
    const response = await post(api, "visitor_consent=given")
    expect(await response.json()).toEqual({ ask: false })
    const id = cookieValue(cookiesSet(response).get("visitor"))
    expect(id).toMatch(UUID)
    expect(await visits(api)).toEqual([
        expect.objectContaining({ visitor_id: id, anonymous: false })
    ])
})

test("in ask-in-eu mode, a visitor the server can't place is asked, as everyone on this computer is", async () => {
    const api = await setup("ask-in-eu")
    const response = await post(api, `visitor=${KEPT_ID}`)
    expect(await response.json()).toEqual({ ask: true })
    expect(cookieValue(cookiesSet(response).get("visitor"))).toBe("")

    const accepted = await post(api, "visitor_consent=given")
    expect(await accepted.json()).toEqual({ ask: false })
    expect(cookieValue(cookiesSet(accepted).get("visitor"))).toMatch(UUID)
})

test("in ask-in-eu mode, a visitor is asked where GDPR applies and remembered elsewhere, by the country of their address", async () => {
    const places: Record<string, string> = {
        "198.51.100.7": "DE",
        "203.0.113.9": "US"
    }
    const asked: string[] = []
    const api = await setup("ask-in-eu", (ip) => {
        asked.push(ip)
        const country = places[ip]
        return country === undefined
            ? null
            : { country, region: null, city: null }
    })

    const german = await post(api, "", { "X-Real-IP": "198.51.100.7" })
    expect(await german.json()).toEqual({ ask: true })
    expect(german.headers.getSetCookie()).toEqual([])

    const american = await post(api, "", { "X-Real-IP": "203.0.113.9" })
    expect(await american.json()).toEqual({ ask: false })
    expect(cookieValue(cookiesSet(american).get("visitor"))).toMatch(UUID)

    // Each visit has its country, and neither its address
    expect(asked).toEqual(["198.51.100.7", "203.0.113.9"])
    const kept = await visits(api)
    expect(kept.map((visit) => [visit.country, visit.anonymous])).toEqual([
        ["DE", true],
        ["US", false]
    ])
    expect(JSON.stringify(kept)).not.toContain("198.51.100.7")
})

test("in never mode, no one is remembered or asked, and an old ID is cleared", async () => {
    const api = await setup("never")
    const fresh = await post(api, "visitor_consent=given")
    expect(await fresh.json()).toEqual({ ask: false })
    expect(fresh.headers.getSetCookie()).toEqual([])

    const before = await post(api, `visitor=${KEPT_ID}`)
    expect(await before.json()).toEqual({ ask: false })
    expect(cookieValue(cookiesSet(before).get("visitor"))).toBe("")
    // One visitor, by the day's hash, whatever their cookies said
    expect(await visits(api)).toEqual([
        expect.objectContaining({
            visitor_id: expect.stringMatching(HASH),
            anonymous: true,
            views: 2
        })
    ])
})

test("the logged-in person is on their visit and its events, by their user's ID", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const api = await setup("remember")
    const ada = await logInAs(api, "ada@example.com")
    await post(api, `${ada.cookie}; visitor=${KEPT_ID}`)
    await post(api, "visitor=9d0c2c1e-55a1-4c1a-8f0e-0a7d5f1b2c3d")

    const kept = await visits(api)
    expect(kept.map((visit) => visit.user_id).sort()).toEqual(
        [ada.id, null].sort()
    )
    const events = await api.database
        .select()
        .from(analytics_events)
        .orderBy(asc(analytics_events.occurred_at))
    expect(JSON.stringify({ kept, events })).not.toContain("ada@example.com")
})

test("a bot's batch is answered, and nothing of it is kept", async () => {
    const api = await setup("remember")
    const response = await post(api, "", {
        "User-Agent":
            "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ask: false })
    expect(response.headers.getSetCookie()).toEqual([])
    expect(await visits(api)).toEqual([])
})

test("over https, the cookies are Secure", async () => {
    const api = await setup("remember")
    const response = await api.api.request(
        "https://shop.example.com/api/visits",
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "User-Agent": IPHONE
            },
            body: JSON.stringify(batch())
        }
    )
    expect(cookiesSet(response).get("visitor")).toMatch(/; Secure/)
    const answered = await api.api.request(
        "https://shop.example.com/api/visits/consent",
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ consent: "given" })
        }
    )
    expect(cookiesSet(answered).get("visitor_consent")).toMatch(/; Secure/)
})

test("when the database is down, the batch fails, so the page sends it again, and no cookie changes", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const database = connect("postgres://unused@127.0.0.1:1/unused", 1)
    const api = await testApi({ database, visitor_mode: "remember" })
    const response = await post(
        api,
        `visitor=${KEPT_ID}; visitor_consent=declined`
    )
    expect(response.status).toBe(500)
    expect(api_failure.parse(await response.json()).error.reason).toBe(
        "unexpected"
    )
    expect(response.headers.getSetCookie()).toEqual([])
    await database.$client.end()
})

test("a batch that isn't one is refused, and one over 64 KB", async () => {
    const api = await setup("remember")
    const wrong = await api.client.api.visits.$post({
        json: { sent_at: Date.now(), events: [] }
    })
    expect(wrong.status).toBe(400)
    expect(api_failure.parse(await wrong.json()).error.reason).toBe("invalid")

    const big = await api.api.request("/api/visits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...batch(), padding: "x".repeat(65 * 1024) })
    })
    expect(big.status).toBe(413)
    expect(api_failure.parse(await big.json()).error.reason).toBe("too-large")
    expect(await visits(api)).toEqual([])
})

test("accepting keeps the answer in a lasting cookie no script reads, and leaves the ID", async () => {
    const api = await setup("ask")
    const response = await api.client.api.visits.consent.$post(
        { json: { consent: "given" } },
        { headers: { cookie: `visitor=${KEPT_ID}` } }
    )
    expect(response.status).toBe(204)
    const consent = cookiesSet(response).get("visitor_consent")
    expect(cookieValue(consent)).toBe("given")
    expect(consent).toMatch(/; Max-Age=34560000/)
    expect(consent).toMatch(/; Path=\//)
    expect(consent).toMatch(/; HttpOnly/)
    expect(consent).toMatch(/; SameSite=Lax/)
    expect(cookiesSet(response).has("visitor")).toBe(false)
})

test("declining keeps the answer and clears the ID at once", async () => {
    const api = await setup("remember")
    const response = await api.client.api.visits.consent.$post(
        { json: { consent: "declined" } },
        { headers: { cookie: `visitor=${KEPT_ID}` } }
    )
    expect(response.status).toBe(204)
    expect(cookieValue(cookiesSet(response).get("visitor_consent"))).toBe(
        "declined"
    )
    const visitor = cookiesSet(response).get("visitor")
    expect(cookieValue(visitor)).toBe("")
    expect(visitor).toMatch(/Max-Age=0/)
})

test("an answer that isn't one is refused", async () => {
    const api = await setup("ask")
    const response = await api.api.request("/api/visits/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consent: "maybe" })
    })
    expect(response.status).toBe(400)
    expect(response.headers.getSetCookie()).toEqual([])
})

test("in ask mode, a visitor is asked, accepts, and is remembered from the next batch", async () => {
    const api = await setup("ask")
    const asked = await post(api)
    expect(await asked.json()).toEqual({ ask: true })

    const accepted = await api.client.api.visits.consent.$post({
        json: { consent: "given" }
    })
    const consent = `visitor_consent=${cookieValue(cookiesSet(accepted).get("visitor_consent"))}`

    const next = await post(api, consent)
    expect(await next.json()).toEqual({ ask: false })
    const id = cookieValue(cookiesSet(next).get("visitor"))
    expect(id).toMatch(UUID)

    const after = await post(api, `${consent}; visitor=${id}`)
    expect(cookieValue(cookiesSet(after).get("visitor"))).toBe(id)
})

test("a token that may only read still records a visit, as nobody's", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const api = await setup("remember")
    const ada = await logInAs(api, "ada@example.com")
    const read_only = await makeApiToken(api.database, ada.id, {
        name: "Reader",
        scopes: ["read"],
        expires_in_days: null
    })
    const acting = await makeApiToken(api.database, ada.id, {
        name: "Actor",
        scopes: ["read", "act"],
        expires_in_days: null
    })
    const read = await post(api, "", {
        Authorization: `Bearer ${read_only.token}`
    })
    expect(read.status).toBe(200)
    await post(api, "", { Authorization: `Bearer ${acting.token}` })

    // The `read` token's POST is a visitor's, the `act` token's Ada's
    expect((await visits(api)).map((visit) => visit.user_id).sort()).toEqual(
        [ada.id, null].sort()
    )
})
