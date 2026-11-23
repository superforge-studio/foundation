import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { expect, onTestFinished, test, vi } from "vitest"
import { ACCESS, type Access } from "@/backend/auth/access"
import type { ApiEnvironment } from "@/backend/context"
import type { Infra } from "@/backend/infra"
import { standInInfra } from "@/backend/infra"
import { testApi } from "@/backend/tests/support/api"
import type { Database } from "@/database"
import { sessions, users } from "@/database/schema"
import { fromNow } from "@/database/time"
import { DAY } from "@/utilities/primitives/durations"
import { api_failure } from "@/utilities/schemas/failures"
import { loggedIn } from "../logged-in"
import { sha256 } from "../tokens"

// Logging in through the whole API, with Infra's stand-in, which answers
// the code and the link as a test key's logins do: from the email to a
// session, by the code and by the link, and out again

const EMAIL = "ada@example.com"

// The team here: Ada, who logs in, with this app's roles
const ADA = {
    slug: "ada",
    first_name: "Ada",
    last_name: "Lovelace",
    email: "Ada@Example.com",
    role: "owner" as const
}
const TEAM: Access = { internal_users: [ADA], roles: ACCESS.roles }

// The whole API with Ada on the team, and anything in `replacing`
function teamApi(replacing: Parameters<typeof testApi>[0] = {}) {
    return testApi({ access: TEAM, ...replacing })
}

// The `session` cookie a response set, as a request sends it back
function sessionCookie(response: Response) {
    const set = response.headers.get("Set-Cookie") ?? ""
    const match = /(?:^|,\s*)session=([^;]*)/.exec(set)
    return match?.[1] === undefined ? null : `session=${match[1]}`
}

// Starts a login for `email`, and answers its code and link's token
async function emailed(
    client: Awaited<ReturnType<typeof testApi>>["client"],
    email = EMAIL
) {
    const response = await client.api.auth.start.$post({ json: { email } })
    expect(response.status).toBe(200)
    if (response.status !== 200) {
        throw new Error("The login didn't start")
    }
    const { development } = await response.json()
    if (development === null || development.link === null) {
        throw new Error("A dev server's login answers its code and link")
    }
    const [, token = ""] = development.link.split("#")
    return { code: development.code, token }
}

test("logs in with the emailed code, making the user, and the session says who", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const { client, database } = await teamApi()
    const { code } = await emailed(client)

    const verified = await client.api.auth.verify.$post({
        json: { email: EMAIL, code }
    })
    expect(verified.status).toBe(200)
    const cookie = sessionCookie(verified)
    expect(cookie).not.toBeNull()

    const session = await client.api.auth.session.$get(
        {},
        { headers: { cookie: cookie ?? "" } }
    )
    const { user } = await session.json()
    expect(user?.email).toBe(EMAIL)

    const [row] = await database.select().from(users)
    expect(row?.logged_in_at).not.toBeNull()
})

test("the session's cookie is kept from scripts and other sites", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const { client } = await teamApi()
    const { code } = await emailed(client)
    const verified = await client.api.auth.verify.$post({
        json: { email: EMAIL, code }
    })
    const set = verified.headers.get("Set-Cookie") ?? ""
    expect(set).toMatch(/HttpOnly/)
    expect(set).toMatch(/SameSite=Lax/)
    expect(set).toMatch(/Path=\//)
    expect(set).toMatch(/Max-Age=2592000/)
})

test("a build never answers the code, whatever Infra says", async () => {
    vi.stubEnv("DEV", false)
    onTestFinished(() => {
        vi.unstubAllEnvs()
    })
    const { client } = await teamApi()
    const response = await client.api.auth.start.$post({
        json: { email: EMAIL }
    })
    expect(response.status).toBe(200)
    if (response.status === 200) {
        expect((await response.json()).development).toBeNull()
    }
})

test("logs in with the email's link", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const { client } = await teamApi()
    const { token } = await emailed(client)
    const verified = await client.api.auth.verify.$post({ json: { token } })
    expect(verified.status).toBe(200)
    if (verified.status === 200) {
        expect((await verified.json()).user.email).toBe(EMAIL)
    }
})

test("the email's link opens this app's /login, and the answer names the address it went to", async () => {
    const { client } = await teamApi()
    const response = await client.api.auth.start.$post({
        json: { email: EMAIL }
    })
    expect(response.status).toBe(200)
    if (response.status === 200) {
        const { email, with_link, development } = await response.json()
        expect(email).toBe(EMAIL)
        expect(with_link).toBe(true)
        expect(development?.link?.split("#")[0]).toBe("http://localhost/login")
    }
})

test("the address is trimmed and lowercased, so it's one user however it's typed", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const { client, database } = await teamApi()
    for (const typed of [" Ada@Example.com ", "ada@example.com"]) {
        const { code } = await emailed(client, typed)
        const verified = await client.api.auth.verify.$post({
            json: { email: typed, code }
        })
        expect(verified.status).toBe(200)
    }
    expect(await database.select().from(users)).toHaveLength(1)
})

test("logging in again ends this browser's last session", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const { client, database } = await teamApi()
    const first = await emailed(client)
    const before = await client.api.auth.verify.$post({
        json: { email: EMAIL, code: first.code }
    })
    const cookie = sessionCookie(before) ?? ""

    const second = await emailed(client)
    await client.api.auth.verify.$post(
        { json: { email: EMAIL, code: second.code } },
        { headers: { cookie } }
    )
    const rows = await database.select().from(sessions)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.token_hash).not.toBe(
        await sha256(cookie.replace("session=", ""))
    )
})

test("a wrong code says how many tries are left, and the right one still works", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const { client } = await teamApi()
    const { code } = await emailed(client)
    const wrong = code === "000000" ? "111111" : "000000"

    const refused = await client.api.auth.verify.$post({
        json: { email: EMAIL, code: wrong }
    })
    expect(refused.status).toBe(400)
    expect(await refused.json()).toMatchObject({
        error: { reason: "wrong-code", attempts_left: 4 }
    })

    const verified = await client.api.auth.verify.$post({
        json: { email: EMAIL, code }
    })
    expect(verified.status).toBe(200)
})

test("a spent link is refused", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const { client } = await teamApi()
    const { token } = await emailed(client)
    await client.api.auth.verify.$post({ json: { token } })
    const again = await client.api.auth.verify.$post({ json: { token } })
    expect(again.status).toBe(400)
    expect(api_failure.parse(await again.json()).error.reason).toBe("no-link")
})

test("an address that isn't one is refused before Infra is asked", async () => {
    const { client } = await teamApi()
    const response = await client.api.auth.start.$post({
        json: { email: "not an address" }
    })
    expect(response.status).toBe(400)
    const { error } = api_failure.parse(await response.json())
    expect(error.reason).toBe("invalid")
    expect(error.issues?.map((issue) => issue.path)).toEqual(["email"])
})

// An Infra that refuses every login the same way
function refusing(
    start: Awaited<ReturnType<Infra["startLogin"]>>,
    verify: Awaited<ReturnType<Infra["verifyLogin"]>> = {
        ok: false,
        error: { reason: "unavailable", message: "Infra is down." }
    }
): Infra {
    return {
        ...standInInfra(),
        startLogin: async () => start,
        verifyLogin: async () => verify,
        fileComment: async () => ({
            ok: false,
            error: { reason: "unavailable", message: "Infra is down." }
        })
    }
}

test("Infra's limits are answered 429, with when to ask again", async () => {
    const { client } = await teamApi({
        infra: refusing({
            ok: false,
            error: {
                reason: "rate-limited",
                limit: "address",
                retry_after: 1800,
                message: "Ask again in about 30 minutes."
            }
        })
    })
    const response = await client.api.auth.start.$post({
        json: { email: EMAIL }
    })
    expect(response.status).toBe(429)
    expect(response.headers.get("Retry-After")).toBe("1800")
    const { error } = api_failure.parse(await response.json())
    expect(error).toMatchObject({
        reason: "rate-limited",
        retry_after: 1800
    })
})

test("why Infra failed reaches the business's own people and a dev server, never a visitor", async () => {
    vi.stubEnv("DEV", false)
    onTestFinished(() => {
        vi.unstubAllEnvs()
    })
    const cause =
        "No one can log in: INFRA_SECRET_KEY isn't set on the app's service in Railway."
    const { client } = await teamApi({
        infra: refusing(
            { ok: false, error: { reason: "unavailable", message: cause } },
            { ok: false, error: { reason: "unavailable", message: cause } }
        ),
        access: {
            internal_users: [
                {
                    slug: "grace",
                    first_name: "Grace",
                    last_name: "Hopper",
                    email: "grace@example.com"
                }
            ],
            roles: ACCESS.roles
        }
    })
    async function failed(response: Response | { json(): Promise<unknown> }) {
        return api_failure.parse(await response.json()).error
    }

    // One of the team, by the address they typed, is told why, with the
    // same plain message a visitor gets
    const team = await client.api.auth.start.$post({
        json: { email: "Grace@Example.com" }
    })
    expect(team.status).toBe(503)
    expect(await failed(team)).toEqual({
        reason: "unavailable",
        message: "Login isn't working right now. Try again soon.",
        cause
    })
    const team_code = await client.api.auth.verify.$post({
        json: { email: "grace@example.com", code: "123456" }
    })
    expect((await failed(team_code)).cause).toBe(cause)

    // Nor is anyone else, nor a link, which names no one in a build
    const visitor = await client.api.auth.verify.$post({
        json: { email: EMAIL, code: "123456" }
    })
    expect((await failed(visitor)).cause).toBeUndefined()
    const link = await client.api.auth.verify.$post({
        json: { token: "a".repeat(43) }
    })
    expect((await failed(link)).cause).toBeUndefined()

    // A dev server tells whoever's there
    vi.stubEnv("DEV", true)
    const developer = await client.api.auth.verify.$post({
        json: { email: EMAIL, code: "123456" }
    })
    expect((await failed(developer)).cause).toBe(cause)
})

test("an email that didn't go out is 502, and an Infra that can't be asked 503", async () => {
    const not_sent = await teamApi({
        infra: refusing({
            ok: false,
            error: { reason: "not-sent", message: "Resend refused it." }
        })
    })
    const response = await not_sent.client.api.auth.start.$post({
        json: { email: EMAIL }
    })
    expect(response.status).toBe(502)

    const down = await teamApi({
        infra: refusing({
            ok: false,
            error: { reason: "unavailable", message: "Infra is down." }
        })
    })
    const started = await down.client.api.auth.start.$post({
        json: { email: EMAIL }
    })
    expect(started.status).toBe(503)
    const verified = await down.client.api.auth.verify.$post({
        json: { token: "a".repeat(43) }
    })
    expect(verified.status).toBe(503)
    expect(api_failure.parse(await verified.json()).error.reason).toBe(
        "unavailable"
    )
})

test("logging out ends the session and clears the cookie", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const { client, database } = await teamApi()
    const { code } = await emailed(client)
    const verified = await client.api.auth.verify.$post({
        json: { email: EMAIL, code }
    })
    const cookie = sessionCookie(verified) ?? ""

    const logged_out = await client.api.auth.logout.$post(
        {},
        { headers: { cookie } }
    )
    expect(logged_out.status).toBe(200)
    expect(logged_out.headers.get("Set-Cookie")).toMatch(/session=;/)
    expect(await database.select().from(sessions)).toHaveLength(0)

    const session = await client.api.auth.session.$get(
        {},
        { headers: { cookie } }
    )
    expect(await session.json()).toEqual({ user: null, permissions: null })
})

// A user logged in through the API, with their session's cookie
async function loggedInUser(api: Awaited<ReturnType<typeof testApi>>) {
    const { code } = await emailed(api.client)
    const verified = await api.client.api.auth.verify.$post({
        json: { email: EMAIL, code }
    })
    const cookie = sessionCookie(verified) ?? ""
    return { cookie, token_hash: await sha256(cookie.replace("session=", "")) }
}

// Sets when the session behind this hash runs out
async function expiresIn(database: Database, token_hash: string, days: number) {
    await database
        .update(sessions)
        .set({ expires_at: fromNow(days * DAY) })
        .where(eq(sessions.token_hash, token_hash))
}

test("a session that has run out logs no one in", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const api = await teamApi()
    const { cookie, token_hash } = await loggedInUser(api)
    await expiresIn(api.database, token_hash, -1)
    const session = await api.client.api.auth.session.$get(
        {},
        { headers: { cookie } }
    )
    expect(await session.json()).toEqual({ user: null, permissions: null })
})

test("a session in use is renewed for its whole lifetime, at most once a day", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const api = await teamApi()
    const { cookie, token_hash } = await loggedInUser(api)

    // Just started: nothing to renew
    const fresh = await api.client.api.auth.session.$get(
        {},
        { headers: { cookie } }
    )
    expect(fresh.headers.get("Set-Cookie")).toBeNull()

    // Ten days left: renewed to 30, cookie and all
    await expiresIn(api.database, token_hash, 10)
    const renewed = await api.client.api.auth.session.$get(
        {},
        { headers: { cookie } }
    )
    expect(renewed.headers.get("Set-Cookie")).toMatch(/session=/)
    const [row] = await api.database
        .select({ expires_at: sessions.expires_at })
        .from(sessions)
    expect(row?.expires_at.getTime()).toBeGreaterThan(Date.now() + 29 * DAY)
})

test("loggedIn lets a live session through with its user, and answers 401 without one", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const api = await teamApi()
    const { cookie } = await loggedInUser(api)

    // A route of the test's own behind it, on the same database, with the
    // team, which the middleware reads each user's names and role from
    const app = new Hono<ApiEnvironment>()
        .use(async (context, next) => {
            context.set("database", api.database)
            context.set("access", TEAM)
            await next()
        })
        .get("/private", loggedIn, (context) =>
            context.json({
                email: context.var.user.email,
                role: context.var.user.role
            })
        )

    const allowed = await app.request("/private", { headers: { cookie } })
    expect(await allowed.json()).toEqual({ email: EMAIL, role: "owner" })

    const refused = await app.request("/private")
    expect(refused.status).toBe(401)
    expect(api_failure.parse(await refused.json()).error.reason).toBe(
        "logged-out"
    )
})

test("someone listed logs in with the names and role the list gives, and their first login tells the rest of the team, once", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const api = await teamApi()
    for (let time = 0; time < 2; time++) {
        const { code } = await emailed(api.client)
        const verified = await api.client.api.auth.verify.$post(
            { json: { email: EMAIL, code } },
            { headers: { "User-Agent": "Test browser" } }
        )
        expect(verified.status).toBe(200)
        if (verified.status === 200) {
            expect((await verified.json()).user).toMatchObject({
                slug: "ada",
                email: EMAIL,
                name: "Ada Lovelace",
                first_name: "Ada",
                last_name: "Lovelace",
                role: "owner"
            })
        }
    }
    const [user] = await api.database.select().from(users)
    const [session] = await api.database.select().from(sessions)
    expect(session?.user_agent).toBe("Test browser")
    // `user-added`, queued in the login's own transaction, since no
    // server's start had made them yet, named for them, so once
    expect(await api.queued()).toEqual([
        {
            workflow: "tell-team-of-new-member",
            input: { user_id: user?.id, email: EMAIL },
            id: `tell-team-of-new-member-${user?.id}`,
            queue: "background"
        }
    ])
    expect(api.started).toEqual([])
})

test("only the list lets anyone in: taken off it, someone is logged out at their next request, and listed again, back", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const api = await teamApi()
    const { cookie } = await loggedInUser(api)
    const headers = { headers: { cookie } }
    expect((await api.client.api.users.$get({}, headers)).status).toBe(200)

    // Taken off the list: the same session is no one's at once
    const listed = api.internal_users.splice(0)
    expect((await api.client.api.users.$get({}, headers)).status).toBe(401)
    const session = await api.client.api.auth.session.$get({}, headers)
    expect(await session.json()).toEqual({ user: null, permissions: null })

    // Listed again, with the same slug: the same session counts again
    api.internal_users.push(...listed)
    expect((await api.client.api.users.$get({}, headers)).status).toBe(200)
})

test("a session whose person was deactivated logs no one in, even while they're listed", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const api = await teamApi()
    const { cookie } = await loggedInUser(api)
    await api.database
        .update(users)
        .set({ deactivated_at: new Date() })
        .where(eq(users.slug, "ada"))
    const session = await api.client.api.auth.session.$get(
        {},
        { headers: { cookie } }
    )
    expect((await session.json()).user).toBeNull()
})

test("anyone not on the team is refused before Infra is asked, so nothing is emailed to them", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const asked: string[] = []
    const stand_in = standInInfra()
    const api = await teamApi({
        infra: {
            ...stand_in,
            startLogin: async (request) => {
                asked.push(request.address)
                return await stand_in.startLogin(request)
            },
            verifyLogin: (proof) => stand_in.verifyLogin(proof),
            fileComment: (comment) => stand_in.fileComment(comment)
        }
    })

    const stranger = await api.client.api.auth.start.$post({
        json: { email: "stranger@example.com" }
    })
    expect(stranger.status).toBe(403)
    expect(api_failure.parse(await stranger.json()).error.reason).toBe(
        "not-listed"
    )
    expect(asked).toEqual([])

    // Ada, on the team, logs in
    const { code } = await emailed(api.client)
    const ada = await api.client.api.auth.verify.$post({
        json: { email: EMAIL, code }
    })
    expect(ada.status).toBe(200)
    expect(asked).toEqual([EMAIL])
})

test("the session says what its person may do in each area", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const api = await teamApi({
        access: {
            internal_users: [{ ...ADA, role: "member" }],
            roles: { owner: "everything", member: { workflows: "read" } }
        }
    })
    const { cookie } = await loggedInUser(api)
    const session = await api.client.api.auth.session.$get(
        {},
        { headers: { cookie } }
    )
    expect((await session.json()).permissions).toEqual({
        team: "none",
        workflows: "read",
        jobs: "none",
        files: "none"
    })
})
