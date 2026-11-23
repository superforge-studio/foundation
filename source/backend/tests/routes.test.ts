import { Hono } from "hono"
import { beforeEach, expect, test, vi } from "vitest"
import { ACCESS, type Access } from "@/backend/auth/access"
import {
    loggedIn,
    maybeLoggedIn,
    permitted,
    requirementOf
} from "@/backend/auth/logged-in"
import type { ApiEnvironment } from "@/backend/context"
import { testApi } from "@/backend/tests/support/api"
import { APP_ANYONE, appSaysWhoMayCall } from "@/backend/tests/support/app"
import { logInAs } from "@/backend/tests/support/login"
import { api_failure } from "@/utilities/schemas/failures"

// Who may call each route, said at the route: every route under /api names
// its area of the app (`permitted`, auth/logged-in.ts), is someone's own
// (`loggedIn`), asks who's logged in without needing anyone
// (`maybeLoggedIn`), or is one of the few anyone may call, listed here with
// why, the app's own in ./support/app.ts. So a route can't be added without
// saying who may call it. And what a role and a token may do, through
// routes that name their area.

/** The routes anyone may call, and why each may: the template's, then the app's. */
const ANYONE: Record<string, string> = {
    "GET /api/health": "Railway's healthcheck, which needs no one",
    "POST /api/auth/start": "Logging in, before anyone is",
    "POST /api/auth/verify": "Logging in, before anyone is",
    "POST /api/auth/logout": "Ends the session its own cookie holds, if any",
    "POST /api/visits/consent":
        "A visitor's answer to the banner, about their own browser",
    "POST /api/webhooks/:source":
        "Other services, each delivery checked by its signature (webhooks/)",
    ...APP_ANYONE
}

// The methods a route answers, as the routes list them
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"]

beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {})
})

test("every route says who may call it", async () => {
    const { api } = await testApi()
    const handlers = new Map<string, unknown[]>()
    for (const route of api.routes) {
        if (METHODS.includes(route.method) && route.path.startsWith("/api/")) {
            const key = `${route.method} ${route.path}`
            handlers.set(key, [...(handlers.get(key) ?? []), route.handler])
        }
    }
    const says = (each: unknown) =>
        each === loggedIn ||
        each === maybeLoggedIn ||
        requirementOf(each) !== undefined ||
        appSaysWhoMayCall(each)
    const unsaid = [...handlers]
        .filter(([key, list]) => !(key in ANYONE) && !list.some(says))
        .map(([key]) => key)
    expect(unsaid).toEqual([])
    // And nothing listed here that no route answers any more
    expect(Object.keys(ANYONE).filter((key) => !handlers.has(key))).toEqual([])
})

// A team whose members may read the workflows and nothing else
const NARROW: Access = {
    internal_users: [],
    roles: { ...ACCESS.roles, member: { workflows: "read" } }
}

test("a role reaches only its areas, at its level, and says what it lacked", async () => {
    const api = await testApi({ access: NARROW })
    const member = await logInAs(api, "grace@example.com", "member")
    const headers = { headers: { cookie: member.cookie } }

    const runs = await api.client.api.workflows.runs.$get({}, headers)
    expect(runs.status).toBe(200)

    const retry = await api.client.api.workflows.runs[":id"].retry.$post(
        { param: { id: "some-run" } },
        headers
    )
    expect(retry.status).toBe(403)
    expect(api_failure.parse(await retry.json()).error).toEqual({
        reason: "not-permitted",
        message: "As a member, you can't change workflows here",
        area: "workflows",
        level: "write"
    })
})

test("an API token never does more than its person's role, nor more than it was given", async () => {
    const api = await testApi({ access: NARROW })
    const owner = await logInAs(api, "ada@example.com")
    const member = await logInAs(api, "grace@example.com", "member")

    // A token of the owner's that may only read: refused a write
    const reading = await madeToken(api, owner.cookie, ["read"])
    const owner_retry = await api.api.request(
        "http://localhost/api/jobs/prune-sessions",
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${reading}`,
                "Content-Type": "application/json"
            },
            body: "{}"
        }
    )
    expect(owner_retry.status).toBe(403)
    expect(api_failure.parse(await owner_retry.json()).error.reason).toBe(
        "read-only"
    )

    // A token of the member's that may act: still only what they may
    const acting = await madeToken(api, member.cookie, ["read", "act"])
    const member_jobs = await api.api.request("http://localhost/api/jobs", {
        headers: { Authorization: `Bearer ${acting}` }
    })
    expect(member_jobs.status).toBe(403)
    expect(api_failure.parse(await member_jobs.json()).error).toMatchObject({
        reason: "not-permitted",
        area: "jobs",
        level: "read"
    })
    const member_runs = await api.api.request(
        "http://localhost/api/workflows/runs",
        { headers: { Authorization: `Bearer ${acting}` } }
    )
    expect(member_runs.status).toBe(200)
})

test("a route can say the level it needs, as for a POST that only reads", async () => {
    const api = await testApi({ access: NARROW })
    const member = await logInAs(api, "grace@example.com", "member")
    const app = new Hono<ApiEnvironment>()
        .use(async (context, next) => {
            context.set("database", api.database)
            context.set("access", {
                internal_users: api.internal_users,
                roles: NARROW.roles
            })
            await next()
        })
        .post("/search", permitted("workflows", "read"), (context) =>
            context.json({ searched: true })
        )
        .post("/change", permitted("workflows"), (context) =>
            context.json({ changed: true })
        )
    const headers = { cookie: member.cookie }

    const searched = await app.request("/search", { method: "POST", headers })
    expect(searched.status).toBe(200)
    const changed = await app.request("/change", { method: "POST", headers })
    expect(changed.status).toBe(403)
})

// Makes an API token as whoever's logged in with `cookie`, and answers it
async function madeToken(
    api: Awaited<ReturnType<typeof testApi>>,
    cookie: string,
    scopes: ("read" | "act")[]
) {
    const made = await api.client.api.account.tokens.$post(
        { json: { name: "Script", scopes } },
        { headers: { cookie } }
    )
    if (made.status !== 200) {
        throw new Error("The test's token wasn't made")
    }
    return (await made.json()).token
}
