import { type Context, Hono } from "hono"
import { z } from "zod"
import { agent_allow, MCP_PATH } from "@/utilities/schemas/agents"
import { inBrowser, loggedIn } from "../auth/logged-in"
import type { ApiEnvironment } from "../context"
import { failure, validated } from "../failures"
import { requestOrigin } from "../infra"

// Claude connecting to the app's MCP, as the team sees it: the Allow page,
// which shows what Claude asked for and sends the browser back to Claude
// once someone allows or declines it, and their Connected list on the
// account page. Infra logs Claude in (through `@superforge/infra`, infra/); these tell it who
// allowed what. Anyone on the team, logged in on a browser, may, for
// themselves (`loggedIn`, `inBrowser`): a token can't allow another, or
// see the connections. What Claude then may do is what both their role
// and what they allowed let it (auth/logged-in.ts).

// Whether a request Claude made is for this app's own MCP, at its origin
// and `MCP_PATH`, the only address a token the team allows opens
function forThisMcp(request_url: string, resource: string) {
    return resource === `${requestOrigin(request_url)}${MCP_PATH}`
}

// Whether where Infra sends the browser back is a web address, the only
// kind the Allow page goes to: Infra allows only Claude's own callback and
// a loopback one, and this keeps a `javascript:` address off the page
// whatever Infra answers
function goesBackOverHttp(redirect_to: string) {
    return ["https:", "http:"].includes(new URL(redirect_to).protocol)
}

function wrongRedirect(context: Context) {
    console.error(
        "Infra sent the Allow page somewhere that isn't a web address"
    )
    return failure(
        context,
        502,
        "bad-redirect",
        "Claude's login sent back an address the page can't go to"
    )
}

const request_path = z.object({ request_id: z.uuid() })
const connection_path = z.object({ connection_id: z.uuid() })

export const agentRoutes = new Hono<ApiEnvironment>()
    // What Claude asked for, for the Allow page: who's asking, what they
    // may do, and until when the page can allow it
    .get(
        "/connect/:request_id",
        loggedIn,
        inBrowser,
        validated("param", request_path),
        async (context) => {
            const { request_id } = context.req.valid("param")
            const asked = await context.var.infra.agentRequest(request_id)
            if (asked.ok && forThisMcp(context.req.url, asked.data.resource)) {
                return context.json({ request: asked.data }, 200)
            } else if (!asked.ok && asked.error.reason === "unavailable") {
                return unavailable(context)
            } else {
                return failure(
                    context,
                    404,
                    "not-found",
                    "That request was allowed already, or has run out: ask Claude to connect again"
                )
            }
        }
    )

    // They allowed it, as themselves: where their browser goes back to
    // Claude, with what Claude needs to finish logging in
    .post(
        "/connect/:request_id/allow",
        loggedIn,
        inBrowser,
        validated("param", request_path),
        validated("json", agent_allow),
        async (context) => {
            const { request_id } = context.req.valid("param")
            const { scopes } = context.req.valid("json")
            // Only a request for the team's MCP is the team's to allow: one
            // for any other address on the origin, like a customers' MCP a
            // copy adds, is answered not found here, and is for whoever
            // that MCP's people are to allow (auth/others.ts)
            const asked = await context.var.infra.agentRequest(request_id)
            if (!asked.ok && asked.error.reason === "unavailable") {
                return unavailable(context)
            } else if (
                !asked.ok ||
                !forThisMcp(context.req.url, asked.data.resource)
            ) {
                return failure(
                    context,
                    404,
                    "not-found",
                    "That request was allowed already, or has run out: ask Claude to connect again"
                )
            }
            const allowed = await context.var.infra.allowAgent(request_id, {
                user_id: context.var.user.id,
                scopes
            })
            if (allowed.ok && !goesBackOverHttp(allowed.data.redirect_to)) {
                return wrongRedirect(context)
            } else if (allowed.ok) {
                console.info("Claude allowed in", {
                    user_id: context.var.user.id,
                    scopes
                })
                return context.json(allowed.data, 200)
            } else if (allowed.error.reason === "unavailable") {
                return unavailable(context)
            } else if (allowed.error.reason === "not-asked") {
                return failure(
                    context,
                    400,
                    "not-asked",
                    "Claude didn't ask for that"
                )
            } else {
                return failure(
                    context,
                    404,
                    "not-found",
                    "That request was allowed already, or has run out: ask Claude to connect again"
                )
            }
        }
    )

    // They declined it: where their browser goes back to Claude, saying so
    .post(
        "/connect/:request_id/deny",
        loggedIn,
        inBrowser,
        validated("param", request_path),
        async (context) => {
            const { request_id } = context.req.valid("param")
            const denied = await context.var.infra.denyAgent(request_id)
            if (denied.ok && !goesBackOverHttp(denied.data.redirect_to)) {
                return wrongRedirect(context)
            } else if (denied.ok) {
                return context.json(denied.data, 200)
            } else if (denied.error.reason === "unavailable") {
                return unavailable(context)
            } else {
                return failure(
                    context,
                    404,
                    "not-found",
                    "That request was allowed already, or has run out"
                )
            }
        }
    )

    // Where they've let Claude in, oldest first
    .get("/account/connections", loggedIn, inBrowser, async (context) => {
        const listed = await context.var.infra.agentConnections(
            context.var.user.id
        )
        if (listed.ok) {
            return context.json({ connections: listed.data }, 200)
        } else {
            return unavailable(context)
        }
    })

    // Ends one of their own connections: Claude can't refresh it, and what
    // it holds runs out within minutes
    .delete(
        "/account/connections/:connection_id",
        loggedIn,
        inBrowser,
        validated("param", connection_path),
        async (context) => {
            const { connection_id } = context.req.valid("param")
            const { infra, user } = context.var
            const listed = await infra.agentConnections(user.id)
            if (!listed.ok) {
                return unavailable(context)
            } else if (!listed.data.some(({ id }) => id === connection_id)) {
                return failure(
                    context,
                    404,
                    "not-found",
                    "No connection of yours has that ID"
                )
            }
            const ended = await infra.endAgentConnection(connection_id)
            if (ended.ok) {
                console.info("Claude's connection ended", {
                    user_id: user.id,
                    connection_id
                })
                return context.json({ ended: true as const }, 200)
            } else if (ended.error.reason === "unavailable") {
                return unavailable(context)
            } else {
                return failure(
                    context,
                    404,
                    "not-found",
                    "No connection of yours has that ID"
                )
            }
        }
    )

// Infra couldn't be asked: logged where it happened (@superforge/infra)
function unavailable(context: Parameters<typeof failure>[0]) {
    return failure(
        context,
        503,
        "unavailable",
        "The app can't reach Infra right now: try again in a minute"
    )
}
