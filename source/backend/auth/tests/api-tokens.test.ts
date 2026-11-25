import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { mcpWith } from "@/backend/mcp"
import { testApi } from "@/backend/tests/support/api"
import { logInAs } from "@/backend/tests/support/login"
import { api_tokens } from "@/database/schema"
import { fromNow } from "@/database/time"
import { DAY, MINUTE } from "@/utilities/primitives/durations"
import type { AgentScope } from "@/utilities/schemas/agents"
import { api_failure } from "@/utilities/schemas/failures"

// API tokens, through the whole API: one of the business's own makes one on
// their account page, a script logs in with it as them, with what they let
// it do, and revoking it ends it at once

beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
})

const ADA = "ada@example.com"

type Setup = Awaited<ReturnType<typeof testApi>>

// Makes a token as `cookie`'s person, on their account page, and answers
// it with its row
async function makeToken(
    setup: Setup,
    cookie: string,
    json: {
        name?: string
        scopes?: AgentScope[]
        expires_in_days?: 30 | 90 | 365 | null
    } = {}
) {
    const made = await setup.client.api.account.tokens.$post(
        {
            json: {
                name: json.name ?? "Nightly export",
                scopes: json.scopes ?? ["read", "act"],
                expires_in_days: json.expires_in_days
            }
        },
        { headers: { cookie } }
    )
    if (made.status !== 200) {
        throw new Error("The test's token wasn't made")
    }
    return await made.json()
}

// A request to the API as a script, with `token`
async function withToken(
    setup: Setup,
    token: string,
    path: string,
    options: { method?: string; body?: unknown } = {}
) {
    return await setup.api.request(`http://localhost${path}`, {
        method: options.method ?? "GET",
        headers: {
            Authorization: `Bearer ${token}`,
            ...(options.body === undefined
                ? {}
                : { "Content-Type": "application/json" })
        },
        body:
            options.body === undefined
                ? undefined
                : JSON.stringify(options.body)
    })
}

// What the API says a request is logged in as
async function loggedInAs(response: Response) {
    const { user }: { user: { email: string } | null } = await response.json()
    return user?.email ?? null
}

// A failure's reason
async function reasonOf(response: Response) {
    return api_failure.parse(await response.json()).error.reason
}

describe("making one", () => {
    test("shows the token once, and keeps only its hash", async () => {
        const setup = await testApi()
        const { cookie } = await logInAs(setup, ADA)
        const { token, api_token } = await makeToken(setup, cookie)

        expect(token).toMatch(/^api_[0-9A-Za-z]{43}$/)
        expect(api_token).toMatchObject({
            name: "Nightly export",
            preview: token.slice(-4),
            scopes: ["read", "act"],
            expires_at: null,
            last_used_at: null
        })

        const [row] = await setup.database
            .select({ token_hash: api_tokens.token_hash })
            .from(api_tokens)
        expect(row?.token_hash).toMatch(/^[0-9a-f]{64}$/)
        expect(row?.token_hash).not.toContain(token)

        const listed = await setup.client.api.account.tokens.$get(
            {},
            { headers: { cookie } }
        )
        expect(listed.status).toBe(200)
        const body = await listed.text()
        expect(body).not.toContain(token)
        expect(body).not.toContain("token_hash")
        expect(JSON.parse(body).tokens).toHaveLength(1)
    })

    test("lasts as many days as it's given, or until it's revoked", async () => {
        const setup = await testApi()
        const { cookie } = await logInAs(setup, ADA)
        const lasting = await makeToken(setup, cookie)
        expect(lasting.api_token.expires_at).toBeNull()

        const { api_token } = await makeToken(setup, cookie, {
            expires_in_days: 30
        })
        const expires_at = new Date(api_token.expires_at ?? 0).getTime()
        expect(expires_at - Date.now()).toBeGreaterThan(29 * DAY)
        expect(expires_at - Date.now()).toBeLessThanOrEqual(30 * DAY)
    })

    test("keeps each scope once, in order", async () => {
        const setup = await testApi()
        const { cookie } = await logInAs(setup, ADA)
        const { api_token } = await makeToken(setup, cookie, {
            scopes: ["act", "read", "act"]
        })
        expect(api_token.scopes).toEqual(["read", "act"])
    })

    test("refuses a token with no name, no scope or a lifetime not offered", async () => {
        const setup = await testApi()
        const { cookie } = await logInAs(setup, ADA)
        for (const json of [
            { name: "  ", scopes: ["read"] },
            { name: "Export", scopes: [] },
            { name: "Export", scopes: ["read"], expires_in_days: 7 }
        ]) {
            const refused = await setup.api.request(
                "http://localhost/api/account/tokens",
                {
                    method: "POST",
                    headers: { cookie, "Content-Type": "application/json" },
                    body: JSON.stringify(json)
                }
            )
            expect(refused.status).toBe(400)
        }
    })

    test("is only for someone logged in", async () => {
        const setup = await testApi()
        const made = await setup.client.api.account.tokens.$post({
            json: { name: "Mine", scopes: ["read"] }
        })
        expect(made.status).toBe(401)
        expect(await reasonOf(made)).toBe("logged-out")
    })
})

describe("using one", () => {
    test("logs a script in as the person who made it", async () => {
        const setup = await testApi()
        const { cookie } = await logInAs(setup, ADA)
        const { token } = await makeToken(setup, cookie)

        expect(
            await loggedInAs(await withToken(setup, token, "/api/auth/session"))
        ).toBe(ADA)
        expect((await withToken(setup, token, "/api/users")).status).toBe(200)
    })

    test("notes when it was last used, at most once a minute", async () => {
        const setup = await testApi()
        const { cookie } = await logInAs(setup, ADA)
        const { token, api_token } = await makeToken(setup, cookie)
        const lastUsed = async () => {
            const [row] = await setup.database
                .select({ last_used_at: api_tokens.last_used_at })
                .from(api_tokens)
                .where(eq(api_tokens.id, api_token.id))
            return row?.last_used_at ?? null
        }

        await withToken(setup, token, "/api/users")
        const first = await lastUsed()
        expect(first).not.toBeNull()

        // Used again within the minute: left as it was
        await withToken(setup, token, "/api/users")
        expect(await lastUsed()).toEqual(first)

        // Used again once the minute is over: noted
        await setup.database
            .update(api_tokens)
            .set({ last_used_at: fromNow(-2 * MINUTE) })
            .where(eq(api_tokens.id, api_token.id))
        const before = await lastUsed()
        await withToken(setup, token, "/api/users")
        expect((await lastUsed())?.getTime()).toBeGreaterThan(
            before?.getTime() ?? Number.POSITIVE_INFINITY
        )
    })

    test("allowed to read, it reads and changes nothing", async () => {
        const setup = await testApi()
        const { cookie } = await logInAs(setup, ADA)
        const { token } = await makeToken(setup, cookie, { scopes: ["read"] })

        expect((await withToken(setup, token, "/api/users")).status).toBe(200)
        const started = await withToken(
            setup,
            token,
            "/api/jobs/prune-sessions",
            {
                method: "POST",
                body: { input: {}, dry_run: false }
            }
        )
        expect(started.status).toBe(403)
        expect(await reasonOf(started)).toBe("read-only")
        expect(setup.started).toHaveLength(0)
    })

    test("allowed to act, it does what its person could", async () => {
        const setup = await testApi()
        const { cookie } = await logInAs(setup, ADA)
        const { token } = await makeToken(setup, cookie)

        const started = await withToken(
            setup,
            token,
            "/api/jobs/prune-sessions",
            {
                method: "POST",
                body: { input: {}, dry_run: false }
            }
        )
        expect(started.status).toBe(202)
        expect(setup.started).toHaveLength(1)
    })

    test("can't touch tokens, or who logs in where", async () => {
        const setup = await testApi()
        const { cookie } = await logInAs(setup, ADA)
        const { token, api_token } = await makeToken(setup, cookie)

        for (const [method, path] of [
            ["GET", "/api/account/tokens"],
            ["POST", "/api/account/tokens"],
            ["DELETE", `/api/account/tokens/${api_token.id}`],
            ["GET", "/api/account/sessions"],
            ["GET", "/api/account/connections"]
        ] as const) {
            const refused = await withToken(setup, token, path, {
                method,
                body:
                    method === "POST"
                        ? { name: "Another", scopes: ["read", "act"] }
                        : undefined
            })
            expect(refused.status).toBe(403)
            expect(await reasonOf(refused)).toBe("browser-only")
        }
    })

    test("a token that isn't one logs no one in", async () => {
        const setup = await testApi()
        const { cookie } = await logInAs(setup, ADA)
        const { token } = await makeToken(setup, cookie)

        for (const wrong of [
            "api_nope",
            `api_${"a".repeat(43)}`,
            `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`
        ]) {
            expect((await withToken(setup, wrong, "/api/users")).status).toBe(
                401
            )
        }
    })
})

describe("its end", () => {
    test("revoking it refuses the next request at once", async () => {
        const setup = await testApi()
        const { cookie } = await logInAs(setup, ADA)
        const { token, api_token } = await makeToken(setup, cookie)
        expect((await withToken(setup, token, "/api/users")).status).toBe(200)

        const revoked = await setup.client.api.account.tokens[":id"].$delete(
            { param: { id: api_token.id } },
            { headers: { cookie } }
        )
        expect(revoked.status).toBe(200)
        expect((await withToken(setup, token, "/api/users")).status).toBe(401)

        const listed = await setup.client.api.account.tokens.$get(
            {},
            { headers: { cookie } }
        )
        expect(listed.status === 200 && (await listed.json()).tokens).toEqual(
            []
        )
    })

    test("no one revokes another person's", async () => {
        const setup = await testApi()
        const ada = await logInAs(setup, ADA)
        const grace = await logInAs(setup, "grace@example.com")
        const { token, api_token } = await makeToken(setup, ada.cookie)

        const revoked = await setup.client.api.account.tokens[":id"].$delete(
            { param: { id: api_token.id } },
            { headers: { cookie: grace.cookie } }
        )
        expect(revoked.status).toBe(404)
        expect((await withToken(setup, token, "/api/users")).status).toBe(200)
    })

    test("stops working the moment its person leaves the team", async () => {
        const setup = await testApi()
        const { cookie } = await logInAs(setup, ADA)
        const { token } = await makeToken(setup, cookie)
        expect((await withToken(setup, token, "/api/users")).status).toBe(200)

        setup.team.length = 0
        expect((await withToken(setup, token, "/api/users")).status).toBe(401)
        expect(
            await loggedInAs(await withToken(setup, token, "/api/auth/session"))
        ).toBeNull()
    })

    test("stops working the moment its person is listed with another address, and is revoked once the new one logs in", async () => {
        const setup = await testApi()
        const { cookie } = await logInAs(setup, ADA)
        const { token } = await makeToken(setup, cookie)
        const [ada] = setup.team
        if (ada === undefined) {
            throw new Error("Ada isn't listed")
        }

        setup.team[0] = { ...ada, email: "ada@lovelace.dev" }
        expect((await withToken(setup, token, "/api/users")).status).toBe(401)

        await logInAs(setup, "ada@lovelace.dev")
        expect(await setup.database.select().from(api_tokens)).toEqual([])
    })

    test("is refused once it has run out, and still listed", async () => {
        const setup = await testApi()
        const { cookie } = await logInAs(setup, ADA)
        const { token, api_token } = await makeToken(setup, cookie, {
            expires_in_days: 30
        })
        await setup.database
            .update(api_tokens)
            .set({ expires_at: fromNow(-DAY) })
            .where(eq(api_tokens.id, api_token.id))

        expect((await withToken(setup, token, "/api/users")).status).toBe(401)
        const listed = await setup.client.api.account.tokens.$get(
            {},
            { headers: { cookie } }
        )
        expect(
            listed.status === 200 && (await listed.json()).tokens
        ).toHaveLength(1)
    })
})

describe("the MCP", () => {
    test("takes one as the API does, with what it may do", async () => {
        const setup = await testApi()
        const { cookie } = await logInAs(setup, ADA)
        const { token } = await makeToken(setup, cookie, { scopes: ["read"] })
        const mcp = mcpWith(setup.api)
        const client = new Client({ name: "test", version: "1.0.0" })
        await client.connect(
            new StreamableHTTPClientTransport(
                new URL("http://localhost/admin/mcp"),
                {
                    fetch: async (url, init) => await mcp.request(url, init),
                    requestInit: {
                        headers: { Authorization: `Bearer ${token}` }
                    }
                }
            )
        )
        const text = (result: Awaited<ReturnType<Client["callTool"]>>) =>
            (Array.isArray(result.content) ? result.content : [])
                .map((part: { text?: string }) => part.text ?? "")
                .join("\n")

        const users = await client.callTool({
            name: "call_api",
            arguments: { method: "GET", path: "/api/users" }
        })
        expect(text(users)).toMatch(/^200/)
        expect(text(users)).toContain(ADA)

        const started = await client.callTool({
            name: "call_api",
            arguments: {
                method: "POST",
                path: "/api/jobs/prune-sessions",
                body: { input: {}, dry_run: false }
            }
        })
        expect(text(started)).toMatch(/^403/)
        expect(text(started)).toContain("read-only")
        await client.close()
    })
})
