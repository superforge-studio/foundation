import start, { createServerEntry } from "@tanstack/react-start/server-entry"
import { api } from "./backend"
import { oauth } from "./backend/agents/oauth"
import { mcp } from "./backend/mcp"
import { logFailure, logMiss } from "./backend/misses/log"
import { syncAppInternalUsers } from "./backend/users/sync"
import { startWorkflows } from "./backend/workflows/engine"
import { MCP_PATH } from "./utilities/schemas/agents"
import { nameRequest } from "./utilities/tracing"

// What the Node server runs once it's listening (source/node.ts): the
// internal users made to follow the list in backend/auth/access.ts
// (backend/users/sync.ts), and the workflows' start, with their stop as
// Railway stops the deployment (backend/workflows/engine.ts)
export { syncAppInternalUsers } from "./backend/users/sync"
export { startWorkflows, stopWorkflows } from "./backend/workflows/engine"

// A dev server does both as it first loads this, once for its life,
// however many times it loads it again. The build's prerender loads it
// too, and never does, and the tests never load it.
if (import.meta.env.DEV) {
    syncAppInternalUsers()
    startWorkflows()
}

// The client build's files, every prerendered page among them, never reach
// this: the Node server answers them first (source/node.ts), and so does
// Vite's dev server. So this sees /api, the app's own MCP (/admin/mcp,
// backend/mcp/) and where Claude logs in to it (/.well-known/oauth-* and
// /oauth/*, backend/agents/oauth.ts), and anything that isn't a page (a
// 404).
const answer = createServerEntry({
    fetch(request) {
        const { pathname } = new URL(request.url)
        if (pathname.startsWith("/api/")) {
            return api.fetch(request)
        } else if (pathname === MCP_PATH) {
            return mcp.fetch(request)
        } else if (
            pathname.startsWith("/oauth/") ||
            pathname.startsWith("/.well-known/oauth-")
        ) {
            return oauth.fetch(request)
        } else if (request.method !== "GET" && request.method !== "HEAD") {
            return refuseForPage(request)
        } else {
            const route = pageRoute(pathname)
            if (route !== null) {
                nameRequest(request.method, route)
            }
            return start.fetch(request)
        }
    }
})

// The route a page drawn on request is traced as (utilities/tracing.ts):
// the dashboard's, whichever of its screens, since each is drawn in the
// browser, and Claude's Allow page. Anything else is the not-found page,
// whose span keeps its path alone.
function pageRoute(pathname: string) {
    if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) {
        return "/dashboard/*"
    } else if (pathname.startsWith("/connect/")) {
        return "/connect/:request_id"
    } else {
        return null
    }
}

// A page is only ever fetched: Start would draw it for a POST too, and
// answer 200, so a webhook sent to a page's address would look delivered
// to whatever sent it, and nothing would know. It's refused and logged
// instead (backend/misses/), which the sender sees too. The app has no
// server functions, which would take a POST (it's headless,
// workbench/writing-code.md), so nothing of Start's needs another method.
function refuseForPage(request: Request) {
    logMiss(request, 405)
    return new Response("This address takes only GET and HEAD\n", {
        status: 405,
        headers: {
            Allow: "GET, HEAD",
            "Content-Type": "text/plain; charset=utf-8"
        }
    })
}

// What answers, with each request it misses and each one that fails logged
// (backend/misses/): a webhook sent to the wrong address, a link to a page
// that isn't there, a page or a route that broke. Under /api the API logs
// its own misses (backend/failures.ts), since its routes answer 404 too,
// for what isn't there.
export default createServerEntry({
    async fetch(request, options) {
        const response = await answer.fetch(request, options)
        if (response.status >= 500) {
            logFailure(request, response.status)
        } else if (
            response.status === 404 &&
            !new URL(request.url).pathname.startsWith("/api/")
        ) {
            logMiss(request, 404)
        }
        return response
    }
})
