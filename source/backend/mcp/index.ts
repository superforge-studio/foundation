import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { z } from "zod"
import {
    AREA_NAMES,
    allows,
    LEVELS,
    type Permissions
} from "@/utilities/permissions"
import {
    AGENT_SCOPES,
    type AgentScope,
    MCP_PATH
} from "@/utilities/schemas/agents"
import { traceRoutes } from "@/utilities/tracing"
import {
    inBrowser,
    levelFor,
    loggedIn,
    maybeLoggedIn,
    requirementOf
} from "../auth/logged-in"
import { answerNotFound, answerUnexpected, tooLarge } from "../failures"
import { API_BODY_LIMIT, api, type apiWith } from "../index"
import { requestOrigin } from "../infra"

// The app's own MCP, at /admin/mcp (`MCP_PATH`, source/server.ts), which
// Claude connects to
// as one of the business's own people, once they've allowed it on the app's
// Allow page (agents/). It's a client of the app's own API, never of the
// database: each tool calls the API in this process with the token Claude
// brought, so Claude can do what that person can through the API, with
// the same checks (workbench/writing-code.md, "Headless"), and no more.
// README.md here has how Claude connects, and the tools.

/** What Claude reads before it uses the tools, at the start of each session */
const INSTRUCTIONS = `This is the business's own app. You're logged in to it as the person on its team who allowed you in, and you can do through its API what their role lets them, with what they allowed: "read" makes GET requests only, and "act" everything else, except changing who can log in, which only a person on the dashboard can.

- Start with list_routes, which lists the routes of the app's API you may call, each with the area and level it needs, then call one with call_api.
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
    const app = new Hono()
        .use(traceRoutes)
        .notFound(answerNotFound)
        .onError(answerUnexpected)
    return app.all(
        MCP_PATH,
        bodyLimit({ maxSize: API_BODY_LIMIT, onError: tooLarge }),
        async (context) => {
            const authorization = context.req.header("Authorization")
            const origin = requestOrigin(context.req.url)
            const base = new URL(context.req.url).origin

            // Who the token logs in, as the API says: nobody, without one, or
            // with one Infra didn't sign for this app
            const session =
                authorization === undefined
                    ? null
                    : await api.request(`${base}/api/auth/session`, {
                          headers: { Authorization: authorization }
                      })
            if (session?.status === 503) {
                // Infra's keys couldn't be fetched to check the token: Claude
                // tries again, keeping its connection
                return context.json(
                    {
                        error: {
                            reason: "unavailable" as const,
                            message:
                                "Claude's token can't be checked right now. Try again in a minute."
                        }
                    },
                    503,
                    { "Cache-Control": "no-store", "Retry-After": "30" }
                )
            }
            const answered =
                session?.status === 200
                    ? logged_in_session.parse(await session.json())
                    : null
            if (
                answered === null ||
                answered.permissions === null ||
                answered.scopes === null
            ) {
                const challenge = [
                    `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource${MCP_PATH}"`,
                    authorization === undefined ? null : 'error="invalid_token"'
                ]
                    .filter((part) => part !== null)
                    .join(", ")
                return context.json(
                    {
                        error: {
                            reason: "logged-out" as const,
                            message:
                                "Connect Claude to this app: it logs in through the app's own login, with one click to allow it."
                        }
                    },
                    401,
                    {
                        "Cache-Control": "no-store",
                        "WWW-Authenticate": challenge
                    }
                )
            }

            // A server of this request's own, with nothing kept between
            // requests (MCP's stateless mode), so a deploy loses nothing, and
            // a plain JSON answer to each
            const server = new McpServer(
                { name: "app", title: "This app", version: "1.0.0" },
                { instructions: INSTRUCTIONS }
            )
            registerTools(
                server,
                api,
                base,
                authorization ?? "",
                answered.permissions,
                answered.scopes
            )
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
        }
    )
}

// What /api/auth/session answers, of what the MCP needs: who's logged in,
// and what they may do in each area
const logged_in_session = z.object({
    user: z.object({ id: z.string() }).nullable(),
    permissions: z.record(z.enum(AREA_NAMES), z.enum(LEVELS)).nullable(),
    scopes: z.array(z.enum(AGENT_SCOPES)).nullable()
})

// The tools: the API's routes, and calling one as the person
function registerTools(
    server: McpServer,
    api: Api,
    base: string,
    authorization: string,
    permissions: Permissions,
    scopes: readonly AgentScope[]
) {
    server.registerTool(
        "list_routes",
        {
            title: "List the app's routes",
            description:
                "The routes of the app's API under /api that you may call: each one's method and path, with :name for a part of the path to fill in, and the area and level it needs, when it's the business's rather than the person's own. call_api calls one. Routes only a person in a browser may call, and those anyone may call without logging in, aren't listed.",
            annotations: { readOnlyHint: true, openWorldHint: false }
        },
        async () => {
            // Each route's handlers, by its method and path: a route is
            // listed when one of them names its area and the person's role
            // reaches it, or says it's someone's own (`loggedIn`,
            // `maybeLoggedIn`), and none of them is `inBrowser`, which no
            // token gets past
            const handlers = new Map<string, unknown[]>()
            for (const { method, path, handler } of api.routes) {
                // `ALL` is middleware for every method, never a route of its own
                if (METHODS.some((each) => each === method)) {
                    const key = `${method} ${path}`
                    handlers.set(key, [...(handlers.get(key) ?? []), handler])
                }
            }
            const routes: string[] = []
            for (const [key, list] of handlers) {
                const method = key.split(" ")[0] ?? ""
                const requirement = list
                    .map((each) => requirementOf(each))
                    .find((each) => each !== undefined)
                const someones = list.some(
                    (each) => each === loggedIn || each === maybeLoggedIn
                )
                if (list.includes(inBrowser)) {
                    // Only a person in a browser
                } else if (requirement !== undefined) {
                    const level = requirement.level ?? levelFor(method)
                    if (allows(permissions, requirement.area, level)) {
                        routes.push(`${key} (${requirement.area}: ${level})`)
                    }
                } else if (someones) {
                    routes.push(key)
                }
            }
            return text(routes.sort().join("\n"))
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
            // The API refuses it too; this keeps a read-only connection
            // from the routes anyone may call, like starting a login
            if (method !== "GET" && !scopes.includes("act")) {
                return {
                    ...text(
                        `403\n\n${JSON.stringify({
                            error: {
                                reason: "read-only",
                                message:
                                    "You were allowed to read here, not to change anything: only GET requests"
                            }
                        })}`
                    ),
                    isError: true
                }
            }
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
