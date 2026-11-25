import { afterEach, expect, test, vi } from "vitest"
import {
    type Infra,
    type InfraProject,
    type InfraUnavailable,
    type InfraUsing,
    standInInfra
} from "@/backend/infra"
import { testApi } from "@/backend/tests/support/api"
import { logInAs } from "@/backend/tests/support/login"
import { MINUTE } from "@/utilities/primitives/durations"
import { api_failure } from "@/utilities/schemas/failures"

// Where a comment filed here goes, through the whole API, which the
// toolbar asks before it shows: the board of the project the server's key
// is for, or nowhere, on Infra's stand-in or when Infra can't be asked,
// saying why

afterEach(() => {
    vi.useRealTimers()
})

const PROJECT: InfraProject = {
    project: {
        id: "sf_project_Ab12Cd34Ef56Gh78Ij90",
        name: "Example Bakery",
        domains: ["example.com"]
    },
    mode: "test"
}

// What Infra says of a test key that went its lifetime without a call
const EXPIRED: InfraUnavailable = {
    reason: "unavailable",
    message:
        "This test key went a day without a call, so it expired. Ask Claude for a new test key for INFRA_TEST_KEY in the checkout's .env."
}

// The API on an Infra `using` a key, whose `project()` answers `answer`
// and counts how often it's asked, with someone logged in through the
// stand-in's logins; and the board, as they ask for it
async function setup(
    answer: Awaited<ReturnType<Infra["project"]>>,
    using: InfraUsing = "test key"
) {
    let asked = 0
    const infra: Infra = {
        ...standInInfra(),
        project: async () => {
            asked += 1
            return answer
        }
    }
    const api = await testApi({ infra, infra_using: using })
    const { cookie } = await logInAs(api, "ada@example.com")
    const board = async () => {
        const response = await api.client.api.comments.board.$get(
            {},
            { headers: { cookie } }
        )
        expect(response.status).toBe(200)
        return await response.json()
    }
    return { board, asked: () => asked }
}

test("with a key Infra takes, comments go to its project's board, asked of Infra once", async () => {
    const { board, asked } = await setup({ ok: true, data: PROJECT })

    const where = {
        board: {
            project: { id: PROJECT.project.id, name: "Example Bakery" },
            mode: "test"
        }
    }
    expect(await board()).toEqual(where)
    expect(await board()).toEqual(where)
    expect(asked()).toBe(1)
})

test("on Infra's stand-in, nothing keeps a comment, and it says what would", async () => {
    const api = await testApi()
    const { cookie } = await logInAs(api, "ada@example.com")

    const answer = await api.client.api.comments.board.$get(
        {},
        { headers: { cookie } }
    )
    expect(answer.status).toBe(200)
    expect(await answer.json()).toEqual({
        board: null,
        why: {
            reason: "stand-in",
            message: expect.stringContaining("INFRA_TEST_KEY")
        }
    })
})

test("with a key Infra refuses, there's none, in Infra's words, and Infra's asked again a minute on", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    const { board, asked } = await setup({ ok: false, error: EXPIRED })

    expect(await board()).toEqual({ board: null, why: EXPIRED })
    expect(await board()).toEqual({ board: null, why: EXPIRED })
    expect(asked()).toBe(1)

    vi.setSystemTime(Date.now() + MINUTE)
    expect(await board()).toEqual({ board: null, why: EXPIRED })
    expect(asked()).toBe(2)
})

test("with nothing to call, as a build with no secret key, there's none", async () => {
    const nothing: InfraUnavailable = {
        reason: "unavailable",
        message:
            "No one can log in: INFRA_SECRET_KEY isn't set on the app's service in Railway."
    }
    const { board } = await setup({ ok: false, error: nothing }, "nothing")

    expect(await board()).toEqual({ board: null, why: nothing })
})

test("a visitor can't ask", async () => {
    const api = await testApi()

    const answer = await api.client.api.comments.board.$get()
    expect(answer.status).toBe(401)
    const { error } = api_failure.parse(await answer.json())
    expect(error.reason).toBe("logged-out")
})
