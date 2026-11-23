import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { expect, onTestFinished, test, vi } from "vitest"
import type { ApiEnvironment } from "@/backend/context"
import type { Infra } from "@/backend/infra"
import { standInInfra } from "@/backend/infra/stand-in"
import { testApi } from "@/backend/tests/support/api"
import type { Database } from "@/database"
import { sessions, users } from "@/database/schema"
import { fromNow } from "@/database/time"
import { DAY } from "@/utilities/primitives/durations"
import { api_failure } from "@/utilities/schemas/failures"
import { signedIn } from "../signed-in"
import { sha256 } from "../tokens"

// Signing in through the whole API, with Infra's stand-in, which answers
// the code and the link as a test key's sign-ins do: from the email to a
// session, by the code and by the link, and out again

const EMAIL = "ada@example.com"

// The `session` cookie a response set, as a request sends it back
function sessionCookie(response: Response) {
    const set = response.headers.get("Set-Cookie") ?? ""
    const match = /(?:^|,\s*)session=([^;]*)/.exec(set)
    return match?.[1] === undefined ? null : `session=${match[1]}`
}

// Starts a sign-in for `email`, and answers its code and link's token
async function emailed(
    client: Awaited<ReturnType<typeof testApi>>["client"],
    email = EMAIL
) {
    const response = await client.api.auth.start.$post({ json: { email } })
    expect(response.status).toBe(200)
    if (response.status !== 200) {
        throw new Error("The sign-in didn't start")
    }
    const { development } = await response.json()
    if (development === null || development.link === null) {
        throw new Error("A dev server's sign-in answers its code and link")
    }
    const [, token = ""] = development.link.split("#")
    return { code: development.code, token }
}

test("signs in with the emailed code, making the user, and the session says who", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const { client, database } = await testApi()
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
    expect(row?.signed_in_at).not.toBeNull()
})

test("the session's cookie is kept from scripts and other sites", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const { client } = await testApi()
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
    const { client } = await testApi()
    const response = await client.api.auth.start.$post({
        json: { email: EMAIL }
    })
    expect(response.status).toBe(200)
    if (response.status === 200) {
        expect((await response.json()).development).toBeNull()
    }
})

test("signs in with the email's link", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const { client } = await testApi()
    const { token } = await emailed(client)
    const verified = await client.api.auth.verify.$post({ json: { token } })
    expect(verified.status).toBe(200)
    if (verified.status === 200) {
        expect((await verified.json()).user.email).toBe(EMAIL)
    }
})

test("the address is trimmed and lowercased, so it's one user however it's typed", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const { client, database } = await testApi()
    for (const typed of [" Ada@Example.com ", "ada@example.com"]) {
        const { code } = await emailed(client, typed)
        const verified = await client.api.auth.verify.$post({
            json: { email: typed, code }
        })
        expect(verified.status).toBe(200)
    }
    expect(await database.select().from(users)).toHaveLength(1)
})

test("signing in again ends this browser's last session", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const { client, database } = await testApi()
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
    const { client } = await testApi()
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
    const { client } = await testApi()
    const { token } = await emailed(client)
    await client.api.auth.verify.$post({ json: { token } })
    const again = await client.api.auth.verify.$post({ json: { token } })
    expect(again.status).toBe(400)
    expect(api_failure.parse(await again.json()).error.reason).toBe("no-link")
})

test("an address that isn't one is refused before Infra is asked", async () => {
    const { client } = await testApi()
    const response = await client.api.auth.start.$post({
        json: { email: "not an address" }
    })
    expect(response.status).toBe(400)
    const { error } = api_failure.parse(await response.json())
    expect(error.reason).toBe("invalid")
    expect(error.issues?.map((issue) => issue.path)).toEqual(["email"])
})

// An Infra that refuses every sign-in the same way
function refusing(
    start: Awaited<ReturnType<Infra["startSignIn"]>>,
    verify: Awaited<ReturnType<Infra["verifySignIn"]>> = {
        ok: false,
        error: { reason: "unavailable" }
    }
): Infra {
    return {
        ...standInInfra(),
        startSignIn: async () => start,
        verifySignIn: async () => verify,
        fileComment: async () => ({
            ok: false,
            error: { reason: "unavailable" }
        })
    }
}

test("Infra's limits are answered 429, with when to ask again", async () => {
    const { client } = await testApi({
        infra: refusing({
            ok: false,
            error: { reason: "too-many", limit: "email", retry_after: 1800 }
        })
    })
    const response = await client.api.auth.start.$post({
        json: { email: EMAIL }
    })
    expect(response.status).toBe(429)
    expect(response.headers.get("Retry-After")).toBe("1800")
    const { error } = api_failure.parse(await response.json())
    expect(error).toMatchObject({ reason: "too-many", retry_after: 1800 })
})

test("an email that didn't go out is 502, and an Infra that can't be asked 503", async () => {
    const not_sent = await testApi({
        infra: refusing({ ok: false, error: { reason: "not-sent" } })
    })
    const response = await not_sent.client.api.auth.start.$post({
        json: { email: EMAIL }
    })
    expect(response.status).toBe(502)

    const down = await testApi({
        infra: refusing({ ok: false, error: { reason: "unavailable" } })
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

test("signing out ends the session and clears the cookie", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const { client, database } = await testApi()
    const { code } = await emailed(client)
    const verified = await client.api.auth.verify.$post({
        json: { email: EMAIL, code }
    })
    const cookie = sessionCookie(verified) ?? ""

    const signed_out = await client.api.auth["sign-out"].$post(
        {},
        { headers: { cookie } }
    )
    expect(signed_out.status).toBe(200)
    expect(signed_out.headers.get("Set-Cookie")).toMatch(/session=;/)
    expect(await database.select().from(sessions)).toHaveLength(0)

    const session = await client.api.auth.session.$get(
        {},
        { headers: { cookie } }
    )
    expect(await session.json()).toEqual({ user: null })
})

// A user signed in through the API, with their session's cookie
async function signedInUser(api: Awaited<ReturnType<typeof testApi>>) {
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

test("a session that has run out signs no one in", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const api = await testApi()
    const { cookie, token_hash } = await signedInUser(api)
    await expiresIn(api.database, token_hash, -1)
    const session = await api.client.api.auth.session.$get(
        {},
        { headers: { cookie } }
    )
    expect(await session.json()).toEqual({ user: null })
})

test("a session in use is renewed for its whole lifetime, at most once a day", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const api = await testApi()
    const { cookie, token_hash } = await signedInUser(api)

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

test("signedIn lets a live session through with its user, and answers 401 without one", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const api = await testApi()
    const { cookie } = await signedInUser(api)

    // A route of the test's own behind it, on the same database, with who
    // is internal, which the middleware reads each user's role through
    const app = new Hono<ApiEnvironment>()
        .use(async (context, next) => {
            context.set("database", api.database)
            context.set("access", { sign_in: "anyone", internal_users: [] })
            await next()
        })
        .get("/private", signedIn, (context) =>
            context.json({ email: context.var.user.email })
        )

    const allowed = await app.request("/private", { headers: { cookie } })
    expect(await allowed.json()).toEqual({ email: EMAIL })

    const refused = await app.request("/private")
    expect(refused.status).toBe(401)
    expect(api_failure.parse(await refused.json()).error.reason).toBe(
        "signed-out"
    )
})

test("someone new is external, and their sign-up queues the notice to the team, once", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const api = await testApi()
    for (let time = 0; time < 2; time++) {
        const { code } = await emailed(api.client)
        await api.client.api.auth.verify.$post({ json: { email: EMAIL, code } })
    }
    const [user] = await api.database.select().from(users)
    expect(user?.role).toBe("external")
    // `user-signed-up`, queued in the sign-in's own transaction, named for
    // them, and the notice is on it
    expect(await api.queued()).toEqual([
        {
            workflow: "tell-team-of-sign-up",
            input: { user_id: user?.id, email: EMAIL },
            id: `tell-team-of-sign-up-${user?.id}`,
            queue: "background"
        }
    ])
    expect(api.started).toEqual([])
})

test("someone listed as internal is internal from their first sign-in, with their listed name, and no sign-up", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const api = await testApi({
        access: {
            sign_in: "anyone",
            internal_users: [
                {
                    first_name: "Ada",
                    last_name: "Lovelace",
                    email: "Ada@Example.com"
                }
            ]
        }
    })
    const { code } = await emailed(api.client)
    const verified = await api.client.api.auth.verify.$post(
        { json: { email: EMAIL, code } },
        { headers: { "User-Agent": "Test browser" } }
    )
    expect(verified.status).toBe(200)
    if (verified.status === 200) {
        expect((await verified.json()).user).toMatchObject({
            email: EMAIL,
            name: "Ada Lovelace",
            role: "internal"
        })
    }
    const [session] = await api.database.select().from(sessions)
    expect(session?.user_agent).toBe("Test browser")
    // One of the business's own isn't a sign-up: no notice about them
    expect(await api.queued()).toEqual([])
})

test("only the list makes anyone internal: taken off it, or made internal by hand, someone is external from their next request", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const api = await testApi()
    api.internal_users.push({
        first_name: "Ada",
        last_name: "Lovelace",
        email: EMAIL
    })
    const { code } = await emailed(api.client)
    const verified = await api.client.api.auth.verify.$post({
        json: { email: EMAIL, code }
    })
    const cookie = sessionCookie(verified) ?? ""
    const headers = { headers: { cookie } }
    expect((await api.client.api.users.$get({}, headers)).status).toBe(200)

    // Taken off the list: the same session is external at once
    api.internal_users.splice(0)
    const refused = await api.client.api.users.$get({}, headers)
    expect(refused.status).toBe(403)
    const session = await api.client.api.auth.session.$get({}, headers)
    expect((await session.json()).user).toMatchObject({ role: "external" })

    // Made internal in the database by hand: still external
    await api.database
        .update(users)
        .set({ role: "internal" })
        .where(eq(users.email, EMAIL))
    expect((await api.client.api.users.$get({}, headers)).status).toBe(403)

    // And signing in again writes the role the list gives
    const again = await emailed(api.client)
    await api.client.api.auth.verify.$post({
        json: { email: EMAIL, code: again.code }
    })
    const [user] = await api.database
        .select({ role: users.role })
        .from(users)
        .where(eq(users.email, EMAIL))
    expect(user?.role).toBe("external")
})

test("when only listed people may sign in, anyone else is refused before Infra is asked", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const asked: string[] = []
    const stand_in = standInInfra()
    const api = await testApi({
        access: {
            sign_in: "listed",
            internal_users: [
                { first_name: "Ada", last_name: "Lovelace", email: EMAIL }
            ]
        },
        infra: {
            ...stand_in,
            startSignIn: async (request) => {
                asked.push(request.email)
                return await stand_in.startSignIn(request)
            },
            verifySignIn: (proof) => stand_in.verifySignIn(proof),
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

    // The owner, listed as internal, signs in and is made
    const { code } = await emailed(api.client)
    const owner = await api.client.api.auth.verify.$post({
        json: { email: EMAIL, code }
    })
    expect(owner.status).toBe(200)

    // Someone they add can sign in too, as what they were added as
    await api.database
        .insert(users)
        .values({ email: "grace@example.com", role: "external" })
    const added = await emailed(api.client, "grace@example.com")
    const verified = await api.client.api.auth.verify.$post({
        json: { email: "grace@example.com", code: added.code }
    })
    expect(verified.status).toBe(200)
    expect(asked).toEqual([EMAIL, "grace@example.com"])
    // Neither joined by signing in, so no notice went out
    expect(await api.queued()).toHaveLength(0)
})
