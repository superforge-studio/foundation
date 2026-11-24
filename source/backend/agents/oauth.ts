import { Hono } from "hono"
import { AGENT_SCOPES, MCP_PATH } from "@/utilities/schemas/agents"
import { traceRoutes } from "@/utilities/tracing"
import {
    APP_PATHS,
    appInfra,
    type Infra,
    OAUTH_CALLS,
    type OAuthCall,
    requestOrigin
} from "../infra"

// What Claude finds at the app's own addresses, outside /api, when it
// logs in to the MCP (source/server.ts): where to log in, the server's
// metadata, and the OAuth calls themselves, which Infra answers, passed on
// with the app's key so the app's own domain is what Claude sees, at the
// package's paths (`APP_PATHS`: `/oauth`, and the Allow page at
// `/connect`). backend/infra/README.md, "Claude", has the flow.

// Whether a call under `/oauth` is one Claude makes
function isOAuthCall(call: string): call is OAuthCall {
    return OAUTH_CALLS.some((known) => known === call)
}

/**
 * The addresses Claude logs in through, on `infra`: the server's, below,
 * or a test's own
 */
export function oauthWith(infra: () => Infra) {
    // What the MCP is, and who logs Claude in to it (RFC 9728): the app
    // itself, at its own origin, so Claude reads the server's metadata here
    // too. Some clients ask at the bare address, others with the MCP's
    // path after it.
    const resource = (request_url: string) => {
        const origin = requestOrigin(request_url)
        return {
            resource: `${origin}${MCP_PATH}`,
            authorization_servers: [origin],
            scopes_supported: [...AGENT_SCOPES],
            bearer_methods_supported: ["header"]
        }
    }
    return (
        new Hono()
            // Each request's span named for its route (utilities/tracing.ts)
            .use(traceRoutes)
            .get("/.well-known/oauth-protected-resource", (context) =>
                context.json(resource(context.req.url), 200, {
                    "Cache-Control": "no-store"
                })
            )
            .get(
                `/.well-known/oauth-protected-resource${MCP_PATH}`,
                (context) =>
                    context.json(resource(context.req.url), 200, {
                        "Cache-Control": "no-store"
                    })
            )
            .get("/.well-known/oauth-authorization-server", (context) =>
                infra().passOAuth(
                    context.req.raw,
                    "metadata",
                    requestOrigin(context.req.url)
                )
            )
            .all(`${APP_PATHS.oauth}/:call`, (context) => {
                const call = context.req.param("call")
                if (!isOAuthCall(call)) {
                    return context.json({ error: "not-found" }, 404)
                } else {
                    return infra().passOAuth(
                        context.req.raw,
                        call,
                        requestOrigin(context.req.url)
                    )
                }
            })
    )
}

/** The server's, on its Infra */
export const oauth = oauthWith(appInfra)
