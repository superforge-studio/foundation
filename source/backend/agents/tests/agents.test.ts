import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
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

type Setup = Awaited<ReturnType<typeof testApi>>

// A request to the API as Claude, with a token for `email`
async function asClaude(
    setup: Setup,
    path: string,
    options: {
        email?: string
        scopes?: AgentScope[]
        origin?: string
        method?: string
        body?: unknown
    } = {}
) {
    const token = await standInAgentToken({
        email: options.email ?? ADA,
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
        await logInAs(setup, ADA, "internal")
        expect(
            await loggedInAs(await asClaude(setup, "/api/auth/session"))
        ).toBe(ADA)
        expect((await asClaude(setup, "/api/users")).status).toBe(200)
    })

    test("is refused for someone not on the team", async () => {
        const setup = await testApi()
        await logInAs(setup, "bob@example.com")
        const session = await asClaude(setup, "/api/auth/session", {
            email: "bob@example.com"
        })
        expect(await loggedInAs(session)).toBeNull()
        const account = await asClaude(setup, "/api/account", {
            email: "bob@example.com",
            method: "PATCH",
            body: { name: "Bob" }
        })
        expect(account.status).toBe(401)
    })

    test("stops working the moment its person leaves the team", async () => {
        const setup = await testApi()
        await logInAs(setup, ADA, "internal")
        expect((await asClaude(setup, "/api/users")).status).toBe(200)
        setup.internal_users.length = 0
        expect((await asClaude(setup, "/api/users")).status).toBe(401)
    })

    test("is refused on any app but the one it was made for", async () => {
        const setup = await testApi()
        await logInAs(setup, ADA, "internal")
        const elsewhere = await asClaude(setup, "/api/users", {
            origin: "https://someone-else.example"
        })
        expect(elsewhere.status).toBe(401)
    })

    test("is refused once it has run out", async () => {
        const setup = await testApi()
        await logInAs(setup, ADA, "internal")
        const token = await standInAgentToken({ email: ADA, expires_in: "0s" })
        const response = await setup.api.request("http://localhost/api/users", {
            headers: { Authorization: `Bearer ${token}` }
        })
        expect(response.status).toBe(401)
    })

    test("allowed to read, it reads and changes nothing", async () => {
        const setup = await testApi()
        await logInAs(setup, ADA, "internal")
        const read = { scopes: ["read"] satisfies AgentScope[] }
        expect((await asClaude(setup, "/api/users", read)).status).toBe(200)
        const change = await asClaude(setup, "/api/account", {
            ...read,
            method: "PATCH",
            body: { name: "Ada" }
        })
        expect(change.status).toBe(403)
        expect((await change.json()).error.reason).toBe("read-only")
    })

    test("can't touch who logs in, or where", async () => {
        const setup = await testApi()
        await logInAs(setup, ADA, "internal")
        const sessions = await asClaude(setup, "/api/account/sessions")
        expect(sessions.status).toBe(403)
        expect((await sessions.json()).error.reason).toBe("browser-only")
        const added = await asClaude(setup, "/api/users", {
            method: "POST",
            body: { email: "eve@example.com" }
        })
        expect(added.status).toBe(403)
        const connections = await asClaude(setup, "/api/account/connections")
        expect(connections.status).toBe(403)
    })
})

describe("the Allow page and the Connected list", () => {
    // The stand-in, recording what the app tells Infra
    function recordingInfra() {
        const allowed: { request_id: string; email: string }[] = []
        const ended: string[] = []
        const infra: Infra = {
            ...standInInfra(),
            allowAgent: async (request_id, { email }) => {
                allowed.push({ request_id, email })
                return {
                    ok: true,
                    data: { redirect_to: "https://claude.ai/callback?code=x" }
                }
            },
            agentConnections: async (email) => ({
                ok: true,
                data: [
                    {
                        id: "6b9c0a52-7d1b-4c43-9a4b-2f7e3d1c5a01",
                        email,
                        client_name: "Claude",
                        scopes: ["read", "act"],
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
        const { cookie } = await logInAs(setup, ADA, "internal")
        const response = await setup.client.api.connect[
            ":request_id"
        ].allow.$post(
            { param: { request_id: REQUEST }, json: { scopes: ["read"] } },
            { headers: { Cookie: cookie } }
        )
        expect(response.status).toBe(200)
        expect(allowed).toEqual([{ request_id: REQUEST, email: ADA }])
    })

    test("nobody off the team, and no token, may allow it", async () => {
        const { infra, allowed } = recordingInfra()
        const setup = await testApi({ infra })
        const { cookie } = await logInAs(setup, "bob@example.com")
        const outsider = await setup.client.api.connect[
            ":request_id"
        ].allow.$post(
            { param: { request_id: REQUEST }, json: { scopes: ["read"] } },
            { headers: { Cookie: cookie } }
        )
        expect(outsider.status).toBe(403)
        await logInAs(setup, ADA, "internal")
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
        const { cookie } = await logInAs(setup, ADA, "internal")
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

    test("Claude's OAuth calls go to Infra as they are, with the app's key and origin", async () => {
        const sent: Request[] = []
        const infra = infraClient({
            key: `sf_secret_${"a".repeat(32)}`,
            url: "https://infra.example/v1",
            send: async (input, init) => {
                sent.push(new Request(input, init))
                return new Response(null, {
                    status: 302,
                    headers: { Location: "https://vmdsystem.com/connect/1" }
                })
            }
        })
        const oauth = oauthWith(() => infra)
        const response = await oauth.request(
            "http://vmdsystem.com/oauth/authorize?client_id=c&state=s"
        )
        expect(response.status).toBe(302)
        expect(response.headers.get("location")).toBe(
            "https://vmdsystem.com/connect/1"
        )
        const [call] = sent
        expect(call?.url).toBe(
            "https://infra.example/v1/oauth/authorize?client_id=c&state=s"
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
        await logInAs(setup, ADA, "internal")
        const token = await standInAgentToken({ email: ADA })
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
        expect(routes).toContain("GET /api/users")

        const users = await client.callTool({
            name: "call_api",
            arguments: { method: "GET", path: "/api/users" }
        })
        expect(users.isError).toBe(false)
        expect(text(users)).toMatch(/^200/)
        expect(text(users)).toContain(ADA)
        await client.close()
    })
})
