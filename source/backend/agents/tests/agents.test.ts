import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { oauthWith } from "@/backend/agents/oauth"
import {
    type Infra,
    infraClient,
    standInAgentToken,
    standInInfra
} from "@/backend/infra"
import { mcpWith } from "@/backend/mcp"
import { testApi } from "@/backend/tests/support/api"
import { logInAs } from "@/backend/tests/support/login"
import { users } from "@/database/schema"
import type { AgentScope } from "@/utilities/schemas/agents"

// Claude in the app: its token in a cookie's place, what it may and may not
// do, the Allow page's routes and the Connected list, where it logs in,
// and the MCP, all on Infra's stand-in, which checks the tokens a test
// mints as Infra signs them

beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
})

const ADA = "ada@example.com"

// The address Claude's tokens are for: the app's MCP
const RESOURCE = "http://localhost/admin/mcp"

type Setup = Awaited<ReturnType<typeof testApi>>

// The ID of the team member at `email`, as a token names them, or one no
// one has when nobody on the team is
async function userIdOf(setup: Setup, email: string) {
    const [user] = await setup.database
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
    return user?.id ?? crypto.randomUUID()
}

// A request to the API as Claude, with a token for the team member at
// `email`, or for `user_id`
async function asClaude(
    setup: Setup,
    path: string,
    options: {
        email?: string
        user_id?: string
        scopes?: AgentScope[]
        origin?: string
        method?: string
        body?: unknown
    } = {}
) {
    const token = await standInAgentToken({
        user_id:
            options.user_id ?? (await userIdOf(setup, options.email ?? ADA)),
        resource: `${options.origin ?? "http://localhost"}/admin/mcp`,
        scopes: options.scopes,
        origin: options.origin
    })
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

describe("Claude's token", () => {
    test("logs in as the person on the team who allowed it", async () => {
        const setup = await testApi()
        await logInAs(setup, ADA)
        expect(
            await loggedInAs(await asClaude(setup, "/api/auth/session"))
        ).toBe(ADA)
        expect((await asClaude(setup, "/api/users")).status).toBe(200)
    })

    test("is refused for someone not on the team", async () => {
        const setup = await testApi()
        await logInAs(setup, ADA)
        const session = await asClaude(setup, "/api/auth/session", {
            email: "bob@example.com"
        })
        expect(await loggedInAs(session)).toBeNull()
        const users = await asClaude(setup, "/api/users", {
            email: "bob@example.com"
        })
        expect(users.status).toBe(401)
    })

    test("is refused for a token that names an email, not an ID", async () => {
        const setup = await testApi()
        await logInAs(setup, ADA)
        expect(
            (await asClaude(setup, "/api/users", { user_id: ADA })).status
        ).toBe(401)
    })

    test("is refused for another MCP's address on the same app", async () => {
        const setup = await testApi()
        await logInAs(setup, ADA)
        const token = await standInAgentToken({
            user_id: await userIdOf(setup, ADA),
            resource: "http://localhost/mcp"
        })
        const response = await setup.api.request("http://localhost/api/users", {
            headers: { Authorization: `Bearer ${token}` }
        })
        expect(response.status).toBe(401)
    })

    test("stops working the moment its person leaves the team", async () => {
        const setup = await testApi()
        await logInAs(setup, ADA)
        expect((await asClaude(setup, "/api/users")).status).toBe(200)
        setup.internal_users.length = 0
        expect((await asClaude(setup, "/api/users")).status).toBe(401)
    })

    test("is refused on any app but the one it was made for", async () => {
        const setup = await testApi()
        await logInAs(setup, ADA)
        const elsewhere = await asClaude(setup, "/api/users", {
            origin: "https://someone-else.example"
        })
        expect(elsewhere.status).toBe(401)
    })

    test("is refused once it has run out", async () => {
        const setup = await testApi()
        await logInAs(setup, ADA)
        const token = await standInAgentToken({
            user_id: await userIdOf(setup, ADA),
            resource: RESOURCE,
            expires_in: "0s"
        })
        const response = await setup.api.request("http://localhost/api/users", {
            headers: { Authorization: `Bearer ${token}` }
        })
        expect(response.status).toBe(401)
    })

    test("allowed to read, it reads and changes nothing", async () => {
        const setup = await testApi()
        await logInAs(setup, ADA)
        const read = { scopes: ["read"] satisfies AgentScope[] }
        expect((await asClaude(setup, "/api/users", read)).status).toBe(200)
        const change = await asClaude(setup, "/api/jobs/prune-sessions", {
            ...read,
            method: "POST",
            body: {}
        })
        expect(change.status).toBe(403)
        expect((await change.json()).error.reason).toBe("read-only")
    })

    test("can't touch who logs in, or where", async () => {
        const setup = await testApi()
        await logInAs(setup, ADA)
        const sessions = await asClaude(setup, "/api/account/sessions")
        expect(sessions.status).toBe(403)
        expect((await sessions.json()).error.reason).toBe("browser-only")
        const connections = await asClaude(setup, "/api/account/connections")
        expect(connections.status).toBe(403)
    })
})

describe("the Allow page and the Connected list", () => {
    // The stand-in, recording what the app tells Infra
    function recordingInfra() {
        const allowed: { request_id: string; user_id: string }[] = []
        const ended: string[] = []
        const infra: Infra = {
            ...standInInfra(),
            allowAgent: async (request_id, { user_id }) => {
                allowed.push({ request_id, user_id })
                return {
                    ok: true,
                    data: { redirect_to: "https://claude.ai/callback?code=x" }
                }
            },
            agentConnections: async (user_id) => ({
                ok: true,
                data: [
                    {
                        id: "6b9c0a52-7d1b-4c43-9a4b-2f7e3d1c5a01",
                        user_id,
                        client_name: "Claude",
                        scopes: ["read", "act"],
                        resource: RESOURCE,
                        last_used_at: new Date(),
                        created_at: new Date()
                    }
                ]
            }),
            endAgentConnection: async (connection_id) => {
                ended.push(connection_id)
                return { ok: true, data: null }
            }
        }
        return { infra, allowed, ended }
    }
    const REQUEST = "0f3b2c1d-9e8a-4b7c-8d6e-5f4a3b2c1d0e"

    test("someone on the team allows it, as themselves", async () => {
        const { infra, allowed } = recordingInfra()
        const setup = await testApi({ infra })
        const ada = await logInAs(setup, ADA)
        const response = await setup.client.api.connect[
            ":request_id"
        ].allow.$post(
            { param: { request_id: REQUEST }, json: { scopes: ["read"] } },
            { headers: { Cookie: ada.cookie } }
        )
        expect(response.status).toBe(200)
        expect(allowed).toEqual([{ request_id: REQUEST, user_id: ada.id }])
    })

    test("nobody logged out, and no token, may allow it", async () => {
        const { infra, allowed } = recordingInfra()
        const setup = await testApi({ infra })
        const outsider = await setup.client.api.connect[
            ":request_id"
        ].allow.$post({
            param: { request_id: REQUEST },
            json: { scopes: ["read"] }
        })
        expect(outsider.status).toBe(401)
        await logInAs(setup, ADA)
        const token = await asClaude(setup, `/api/connect/${REQUEST}/allow`, {
            method: "POST",
            body: { scopes: ["read"] }
        })
        expect(token.status).toBe(403)
        expect(allowed).toEqual([])
    })

    test("someone disconnects only their own", async () => {
        const { infra, ended } = recordingInfra()
        const setup = await testApi({ infra })
        const { cookie } = await logInAs(setup, ADA)
        const end = (connection_id: string) =>
            setup.client.api.account.connections[":connection_id"].$delete(
                { param: { connection_id } },
                { headers: { Cookie: cookie } }
            )
        expect((await end("1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d")).status).toBe(
            404
        )
        expect((await end("6b9c0a52-7d1b-4c43-9a4b-2f7e3d1c5a01")).status).toBe(
            200
        )
        expect(ended).toEqual(["6b9c0a52-7d1b-4c43-9a4b-2f7e3d1c5a01"])
    })
})

describe("where Claude logs in", () => {
    test("the MCP's metadata names the app itself", async () => {
        const oauth = oauthWith(() => standInInfra())
        const local = await oauth.request(
            "http://localhost:3000/.well-known/oauth-protected-resource"
        )
        expect(await local.json()).toMatchObject({
            resource: "http://localhost:3000/admin/mcp",
            authorization_servers: ["http://localhost:3000"]
        })
        const live = await oauth.request(
            "http://vmdsystem.com/.well-known/oauth-protected-resource/admin/mcp"
        )
        expect((await live.json()).resource).toBe(
            "https://vmdsystem.com/admin/mcp"
        )
    })

    test("the server's metadata names the app's own addresses, with no call to Infra", async () => {
        const sent: Request[] = []
        const infra = infraClient({
            key: `sf_secret_${"a".repeat(32)}`,
            url: "https://infra.example/v1",
            send: async (input, init) => {
                sent.push(new Request(input, init))
                return Response.json({})
            }
        })
        const oauth = oauthWith(() => infra)
        const response = await oauth.request(
            "http://vmdsystem.com/.well-known/oauth-authorization-server"
        )
        expect(response.status).toBe(200)
        expect(await response.json()).toMatchObject({
            issuer: "https://vmdsystem.com",
            authorization_endpoint: "https://vmdsystem.com/oauth/authorize",
            token_endpoint: "https://vmdsystem.com/oauth/token",
            scopes_supported: ["read", "act"]
        })
        expect(sent).toEqual([])
    })

    test("Claude's OAuth calls go to Infra with the app's key and origin, and authorize ends on the Allow page", async () => {
        const sent: Request[] = []
        const request_id = "3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90"
        const infra = infraClient({
            key: `sf_secret_${"a".repeat(32)}`,
            url: "https://infra.example/v1",
            send: async (input, init) => {
                sent.push(new Request(input, init))
                return Response.json({ request: { id: request_id } })
            }
        })
        const oauth = oauthWith(() => infra)
        const response = await oauth.request(
            "http://vmdsystem.com/oauth/authorize?client_id=c&state=s"
        )
        expect(response.status).toBe(302)
        expect(response.headers.get("location")).toBe(
            `https://vmdsystem.com/connect/${request_id}`
        )
        const [call] = sent
        expect(call?.url).toBe(
            "https://infra.example/v1/agents/oauth/authorize?client_id=c&state=s"
        )
        expect(call?.headers.get("authorization")).toBe(
            `Bearer sf_secret_${"a".repeat(32)}`
        )
        expect(call?.headers.get("app-origin")).toBe("https://vmdsystem.com")

        const unknown = await oauth.request("http://vmdsystem.com/oauth/other")
        expect(unknown.status).toBe(404)
    })
})

describe("the MCP", () => {
    test("without a token, it says where to log in", async () => {
        const setup = await testApi()
        const mcp = mcpWith(setup.api)
        const response = await mcp.request("http://localhost/admin/mcp", {
            method: "POST",
            headers: {
                "content-type": "application/json",
                accept: "application/json, text/event-stream"
            },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" })
        })
        expect(response.status).toBe(401)
        expect(response.headers.get("www-authenticate")).toBe(
            'Bearer resource_metadata="http://localhost/.well-known/oauth-protected-resource/admin/mcp"'
        )
    })

    test("answers under /admin, leaving /mcp for a customer MCP", async () => {
        const setup = await testApi()
        const mcp = mcpWith(setup.api)
        const left = await mcp.request("http://localhost/mcp", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" })
        })
        expect(left.status).toBe(404)
    })

    test("lists the API's routes, and calls one as the person", async () => {
        const setup = await testApi()
        await logInAs(setup, ADA)
        const token = await standInAgentToken({
            user_id: await userIdOf(setup, ADA),
            resource: RESOURCE
        })
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

        const routes = text(await client.callTool({ name: "list_routes" }))
        expect(routes).toContain("GET /api/users (team: read)")
        expect(routes).toContain("POST /api/jobs/:name (jobs: write)")
        expect(routes).toContain("GET /api/account/sessions")

        const users = await client.callTool({
            name: "call_api",
            arguments: { method: "GET", path: "/api/users" }
        })
        expect(users.isError).toBe(false)
        expect(text(users)).toMatch(/^200/)
        expect(text(users)).toContain(ADA)
        await client.close()
    })

    test("lists only the routes the person's role reaches", async () => {
        const setup = await testApi({
            access: {
                internal_users: [],
                roles: { owner: "everything", member: { workflows: "read" } }
            }
        })
        await logInAs(setup, ADA, "member")
        const token = await standInAgentToken({
            user_id: await userIdOf(setup, ADA),
            resource: RESOURCE
        })
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
        const listed = await client.callTool({ name: "list_routes" })
        const routes = (Array.isArray(listed.content) ? listed.content : [])
            .map((part: { text?: string }) => part.text ?? "")
            .join("\n")
        expect(routes).toContain("GET /api/workflows/runs (workflows: read)")
        expect(routes).not.toContain("/api/users")
        expect(routes).not.toContain("/api/workflows/runs/:id/retry")
        await client.close()
    })
})
