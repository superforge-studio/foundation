import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { Hono } from "hono"
import { z } from "zod"
import { MCP_PATH } from "@/utilities/schemas/agents"
import { traceRoutes } from "@/utilities/tracing"
import { api, type apiWith } from "../index"
import { requestOrigin } from "../infra/agents"

// The app's own MCP, at /admin/mcp (`MCP_PATH`, source/server.ts), which
// Claude connects to
// as one of the business's own people, once they've allowed it on the app's
// Allow page (agents/). It's a client of the app's own API, never of the
// database: each tool calls the API in this process with the token Claude
// brought, so Claude can do what that person can through the API, with
// the same checks (workbench/writing-code.md, "Headless"), and no more.
// README.md here has how Claude connects, and the tools.

/** What Claude reads before it uses the tools, at the start of each session */
const INSTRUCTIONS = `This is the business's own app. You're signed in to it as the person on its team who allowed you in, and you can do through its API what they can, with what they allowed: "read" makes GET requests only, and "act" everything else, except changing who can sign in, which only a person on the dashboard can.

- Start with list_routes, which lists every route of the app's API, then call one with call_api.
- Every route answers JSON. A failure is { error: { reason, message } }: read the reason, and tell the person what it says.
- Ask the person before anything that changes their data or reaches their customers, like adding, removing or sending something.
- To change many rows at once, use a job, never a route called in a loop: GET /api/jobs lists them, POST /api/jobs/:name with { input } is a dry run that says what it would change, and { input, dry_run: false } starts it. Show the person the dry run, and start it only once they say so. /api/workflows/runs/:id shows how a run went. A change no job makes is code to write in the codebase, not something to do here.`

type Api = ReturnType<typeof apiWith>

// The methods a route can have, as call_api takes them
const METHODS = ["GET", "POST", "PATCH", "PUT", "DELETE"] as const

/**
 * The MCP, answering at `MCP_PATH`, on this API: the server's, below, or a
 * test's
 */
export function mcpWith(api: Api) {
    // Its request's span named for its route, and the API's calls its tools
    // make in it each a span inside it (utilities/tracing.ts)
    return new Hono().use(traceRoutes).all(MCP_PATH, async (context) => {
        const authorization = context.req.header("Authorization")
        const origin = requestOrigin(context.req.url)
        const base = new URL(context.req.url).origin

        // Who the token signs in, as the API says: nobody, without one, or
        // with one Infra didn't sign for this app
        const session =
            authorization === undefined
                ? null
                : await api.request(`${base}/api/auth/session`, {
                      headers: { Authorization: authorization }
                  })
        const signed_in =
            session?.status === 200 &&
            z
                .object({ user: z.object({ id: z.string() }).nullable() })
                .parse(await session.json()).user !== null
        if (!signed_in) {
            const challenge = [
                `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource${MCP_PATH}"`,
                authorization === undefined ? null : 'error="invalid_token"'
            ]
                .filter((part) => part !== null)
                .join(", ")
            return context.json(
                {
                    error: "signed-out" as const,
                    message:
                        "Connect Claude to this app: it signs in through the app's own sign-in, with one click to allow it."
                },
                401,
                { "Cache-Control": "no-store", "WWW-Authenticate": challenge }
            )
        }

        // A server of this request's own, with nothing kept between
        // requests (MCP's stateless mode), so a deploy loses nothing, and
        // a plain JSON answer to each
        const server = new McpServer(
            { name: "app", title: "This app", version: "1.0.0" },
            { instructions: INSTRUCTIONS }
        )
        registerTools(server, api, base, authorization ?? "")
        const transport = new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true
        })
        await server.connect(transport)
        try {
            const response = await transport.handleRequest(context.req.raw)
            response.headers.set("Cache-Control", "no-store")
            return response
        } finally {
            await server.close()
        }
    })
}

// The tools: the API's routes, and calling one as the person
function registerTools(
    server: McpServer,
    api: Api,
    base: string,
    authorization: string
) {
    server.registerTool(
        "list_routes",
        {
            title: "List the app's routes",
            description:
                "Every route of the app's API under /api: its method and path, with :name for a part of the path to fill in. call_api calls one.",
            annotations: { readOnlyHint: true, openWorldHint: false }
        },
        async () => {
            const seen = new Set<string>()
            for (const { method, path } of api.routes) {
                if (METHODS.some((known) => known === method)) {
                    seen.add(`${method} ${path}`)
                }
            }
            return text([...seen].sort().join("\n"))
        }
    )

    server.registerTool(
        "call_api",
        {
            title: "Call the app's API",
            description:
                "Calls one of the app's routes, as the person who allowed you in, and answers its status and its JSON. GET reads; anything else changes something, and needs the person to have allowed you to act.",
            inputSchema: {
                method: z.enum(METHODS),
                path: z
                    .string()
                    .startsWith("/api/")
                    .describe(
                        "The route's path with its parts filled in, like /api/users"
                    ),
                query: z
                    .record(z.string(), z.string())
                    .optional()
                    .describe("Query parameters, for a route that takes them"),
                body: z
                    .unknown()
                    .optional()
                    .describe("The JSON body, for a route that takes one")
            },
            annotations: { openWorldHint: false }
        },
        async ({ method, path, query, body }) => {
            const url = new URL(path, base)
            for (const [name, value] of Object.entries(query ?? {})) {
                url.searchParams.set(name, value)
            }
            const response = await api.request(url.toString(), {
                method,
                headers:
                    body === undefined
                        ? { Authorization: authorization }
                        : {
                              Authorization: authorization,
                              "Content-Type": "application/json"
                          },
                body: body === undefined ? undefined : JSON.stringify(body)
            })
            const answered = await response.text()
            console.info("Claude called the API", {
                method,
                path,
                status: response.status
            })
            return {
                ...text(`${response.status}\n\n${answered}`),
                isError: response.status >= 400
            }
        }
    )
}

function text(value: string): CallToolResult {
    return { content: [{ type: "text", text: value }] }
}

/** The server's MCP, on its API */
export const mcp = mcpWith(api)
