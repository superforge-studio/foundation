import { randomUUID } from "node:crypto"
import { sql } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { deleteExpiredSessions } from "@/backend/auth/sessions"
import { standInAgentToken } from "@/backend/infra"
import { testApi } from "@/backend/tests/support/api"
import { logInAs } from "@/backend/tests/support/login"
import { sessions } from "@/database/schema"
import type { AgentScope } from "@/utilities/schemas/agents"

// The jobs (backend/jobs/): listing them, a dry run that changes nothing,
// starting one, and who may, with the template's example job,
// prune-sessions, on a database of the test's own

beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
})

const ADA = "ada@example.com"

type Setup = Awaited<ReturnType<typeof testApi>>

// Sessions for this user that ran out a day ago
async function expiredSessions(setup: Setup, user_id: string, count: number) {
    await setup.database.insert(sessions).values(
        Array.from({ length: count }, () => ({
            token_hash: randomUUID(),
            user_id,
            user_agent: null,
            expires_at: sql`now() - interval '1 day'`
        }))
    )
}

// How many sessions there are, live or not
async function sessionCount(setup: Setup) {
    return (await setup.database.select().from(sessions)).length
}

// A request to the jobs as Claude, with what Ada allowed
async function asClaude(
    setup: Setup,
    path: string,
    scopes: AgentScope[],
    body: unknown
) {
    const token = await standInAgentToken({ email: ADA, scopes })
    return await setup.api.request(`http://localhost${path}`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
    })
}

describe("the jobs", () => {
    test("lists every job with what it takes", async () => {
        const setup = await testApi()
        const { cookie } = await logInAs(setup, ADA, "internal")
        const response = await setup.client.api.jobs.$get(
            {},
            { headers: { Cookie: cookie } }
        )
        if (response.status !== 200) {
            throw new Error("The jobs didn't list")
        }
        const { jobs } = await response.json()
        expect(jobs.map((job) => job.name)).toContain("prune-sessions")
        expect(jobs[0]?.input).toMatchObject({ type: "object" })
    })

    test("a dry run says what it would change, and changes nothing", async () => {
        const setup = await testApi()
        const { id, cookie } = await logInAs(setup, ADA, "internal")
        await expiredSessions(setup, id, 3)
        const before = await sessionCount(setup)
        const response = await setup.client.api.jobs[":name"].$post(
            { param: { name: "prune-sessions" }, json: { input: {} } },
            { headers: { Cookie: cookie } }
        )
        expect(response.status).toBe(200)
        expect(await response.json()).toMatchObject({
            dry_run: true,
            plan: { changes: 3 }
        })
        expect(await sessionCount(setup)).toBe(before)
        expect(setup.started).toEqual([])
    })

    test("starts the change as a workflow only when asked to", async () => {
        const setup = await testApi()
        const { cookie } = await logInAs(setup, ADA, "internal")
        const response = await setup.client.api.jobs[":name"].$post(
            {
                param: { name: "prune-sessions" },
                json: { input: {}, dry_run: false }
            },
            { headers: { Cookie: cookie } }
        )
        expect(response.status).toBe(202)
        expect(setup.started.map((run) => run.workflow)).toEqual([
            "job-prune-sessions"
        ])
    })

    test("refuses a job that isn't one, or input it doesn't take", async () => {
        const setup = await testApi()
        const { cookie } = await logInAs(setup, ADA, "internal")
        const unknown = await setup.client.api.jobs[":name"].$post(
            { param: { name: "drop-everything" }, json: {} },
            { headers: { Cookie: cookie } }
        )
        expect(unknown.status).toBe(404)
        const wrong = await setup.client.api.jobs[":name"].$post(
            { param: { name: "prune-sessions" }, json: { input: "all" } },
            { headers: { Cookie: cookie } }
        )
        expect(wrong.status).toBe(400)
    })

    test("only the team, and Claude allowed to act, may start one", async () => {
        const setup = await testApi()
        const outsider = await logInAs(setup, "bob@example.com")
        const refused = await setup.client.api.jobs[":name"].$post(
            { param: { name: "prune-sessions" }, json: {} },
            { headers: { Cookie: outsider.cookie } }
        )
        expect(refused.status).toBe(403)

        await logInAs(setup, ADA, "internal")
        const reading = await asClaude(
            setup,
            "/api/jobs/prune-sessions",
            ["read"],
            {}
        )
        expect(reading.status).toBe(403)
        const acting = await asClaude(
            setup,
            "/api/jobs/prune-sessions",
            ["read", "act"],
            {}
        )
        expect(acting.status).toBe(200)
    })
})

describe("prune-sessions", () => {
    test("deletes only sessions that have run out, a batch at a time", async () => {
        const setup = await testApi()
        const { id } = await logInAs(setup, ADA, "internal")
        await expiredSessions(setup, id, 3)
        const live = (await sessionCount(setup)) - 3
        expect(await deleteExpiredSessions(setup.database, 2)).toBe(2)
        expect(await deleteExpiredSessions(setup.database, 2)).toBe(1)
        expect(await deleteExpiredSessions(setup.database, 2)).toBe(0)
        expect(await sessionCount(setup)).toBe(live)
    })
})
