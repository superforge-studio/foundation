import { beforeEach, expect, test, vi } from "vitest"
import { testApi } from "@/backend/tests/support/api"
import { logInAs } from "@/backend/tests/support/login"
import { api_failure } from "@/utilities/schemas/failures"

// The workflows' runs, through the whole API, on workflows recorded rather
// than run (tests/support/recorded.ts): only a role that may read the
// workflows sees them, and only a stopped run runs again. Reading them from DBOS itself is
// engine.test.ts's.

beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {})
})

test("the runs are listed only to a role that may read the workflows", async () => {
    const api = await testApi({
        access: {
            internal_users: [],
            roles: { owner: "everything", member: { team: "read" } }
        }
    })
    const member = await logInAs(api, "maria@example.com", "member")
    const owner = await logInAs(api, "ada@example.com")
    api.runs.set("queued-run", {
        id: "queued-run",
        workflow: "tell-team-of-new-member",
        title: "Tell the team about maria@example.com",
        status: "queued",
        input: "{}",
        error: null,
        created_at: new Date().toISOString(),
        completed_at: null,
        output: null,
        steps: []
    })

    const refused = await api.client.api.workflows.runs.$get(
        {},
        { headers: { cookie: member.cookie } }
    )
    expect(refused.status).toBe(403)

    const listed = await api.client.api.workflows.runs.$get(
        {},
        { headers: { cookie: owner.cookie } }
    )
    expect(listed.status).toBe(200)
    if (listed.status === 200) {
        const { runs } = await listed.json()
        expect(runs.map((run) => run.title)).toEqual([
            "Tell the team about maria@example.com"
        ])
    }
})

test("a failed run runs again; one that didn't fail, or isn't there, doesn't", async () => {
    const api = await testApi()
    const owner = await logInAs(api, "ada@example.com")
    const headers = { headers: { cookie: owner.cookie } }
    api.runs.set("failed-run", {
        id: "failed-run",
        workflow: "tell-team-of-new-member",
        title: "Tell the team about olu@example.com",
        status: "failed",
        input: "{}",
        error: "Infra didn't answer",
        created_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        output: null,
        steps: [
            {
                number: 0,
                name: "read-user",
                status: "done",
                output: "{}",
                error: null,
                started_at: null,
                completed_at: null
            },
            {
                number: 1,
                name: "find-team",
                status: "failed",
                output: null,
                error: "Infra didn't answer",
                started_at: null,
                completed_at: null
            }
        ]
    })

    const found = await api.client.api.workflows.runs[":id"].$get(
        { param: { id: "failed-run" } },
        headers
    )
    expect(found.status).toBe(200)
    if (found.status === 200) {
        expect((await found.json()).run.steps).toHaveLength(2)
    }

    const retried = await api.client.api.workflows.runs[":id"].retry.$post(
        { param: { id: "failed-run" } },
        headers
    )
    expect(retried.status).toBe(200)
    expect(api.retried).toEqual(["failed-run"])

    const again = await api.client.api.workflows.runs[":id"].retry.$post(
        { param: { id: "failed-run" } },
        headers
    )
    expect(again.status).toBe(409)
    expect(api_failure.parse(await again.json()).error.reason).toBe(
        "not-stopped"
    )

    const missing = await api.client.api.workflows.runs[":id"].$get(
        { param: { id: "no-such-run" } },
        headers
    )
    expect(missing.status).toBe(404)
})
