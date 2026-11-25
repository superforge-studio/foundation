import { serve } from "@hono/node-server"
import { serveStatic } from "@hono/node-server/serve-static"
import { trace } from "@opentelemetry/api"
import { ATTR_HTTP_ROUTE } from "@opentelemetry/semantic-conventions"
import { Hono } from "hono"
import { stopTracing } from "./tracing.ts"

/**
 * The Node server Railway runs, `pnpm start` after `pnpm build`. The client
 * build's files come first, every prerendered page among them. Every other
 * request goes to source/server.ts, as Start built it, and so does every
 * request to a host the app says has no files (source/app.ts).
 *
 * Node runs this file from source, stripping its types, so it imports only
 * packages, the build, and source/tracing.ts, which `pnpm start` has
 * already run with `--import`, before this, so it could instrument what
 * this imports: no `@/` paths, nothing else from source/.
 */

type ServerEntry = { fetch(request: Request): Promise<Response> }

// A path, not a specifier, so tsc doesn't look for a build that typecheck
// runs before. Beside Start's entry, the internal users' sync, the
// workflows' start and stop, and the hosts with no files of their own
// (source/server.ts).
const built: {
    default: ServerEntry
    syncAppInternalUsers(): Promise<void>
    startWorkflows(): Promise<void>
    stopWorkflows(): Promise<void>
    HOSTS_WITHOUT_FILES: readonly string[]
} = await import(new URL("../output/server/server.js", import.meta.url).href)

// The hosts whose every path the server answers, like a domain kept for
// short links: never one of the build's files, whatever the path's name
// (source/app.ts)
const hosts_without_files = new Set(built.HOSTS_WITHOUT_FILES)

/**
 * The route a request for one of the build's files is traced as
 * (source/tracing.ts): a page, or anything else at the root, by its own
 * path, since there are only so many, and the hashed files under /assets
 * as one. What's rendered on request is named by its app
 * (utilities/tracing.ts's `traceRoutes`).
 */
function nameFileRequest(method: string, request_path: string) {
    const route = request_path.startsWith("/assets/")
        ? "/assets/*"
        : request_path
    trace
        .getActiveSpan()
        ?.updateName(`${method} ${route}`)
        .setAttribute(ATTR_HTTP_ROUTE, route)
}

/**
 * What browsers and Railway's CDN may keep of the build's files
 * (.railway/railway.ts, `cdn`; workbench/commit-and-deploy.md, "Caching").
 * The build names everything under /assets by its content, so both keep
 * those for good. The rest, the prerendered pages among them, a browser
 * asks for again on each visit (`max-age=0`), so it never holds a page that
 * points at /assets a deploy has replaced, while the edge keeps them
 * (`s-maxage`): a page for a day, or until the next deploy, which purges
 * every page from the edge, and anything else, like the favicon, for an
 * hour, since a deploy leaves those. A day, not a year, so a purge that
 * misses can't leave an old page at the edge for long.
 */
function cacheControl(request_path: string, file: string) {
    if (request_path.startsWith("/assets/")) {
        return "public, max-age=31536000, immutable"
    } else if (file.endsWith(".html")) {
        return "public, max-age=0, s-maxage=86400"
    } else {
        return "public, max-age=0, s-maxage=3600"
    }
}

/**
 * Something rendered on request (the API, a 404), kept out of the edge's
 * cache unless it says otherwise.
 */
async function rendered(request: Request) {
    const response = await built.default.fetch(request)
    if (!response.headers.has("Cache-Control")) {
        const headers = new Headers(response.headers)
        headers.set("Cache-Control", "no-store")
        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers
        })
    } else {
        return response
    }
}

/**
 * What every answer says of how a browser may treat it, files, pages and
 * the API alike: no other site may frame it, so no one can draw the Allow
 * page or the admin under someone's click; a file is only ever what its
 * type says; a link out tells the next site only this one's origin; and,
 * on any host but this computer's, the site is only ever reached over
 * HTTPS, for a year. A Content-Security-Policy past `frame-ancestors`, one
 * that limits scripts and styles, is the app's to add once it's tuned to
 * what its pages load.
 */
function securityHeaders(request_url: string) {
    const headers: Record<string, string> = {
        "Content-Security-Policy": "frame-ancestors 'none'",
        "X-Frame-Options": "DENY",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin"
    }
    if (!LOCAL_HOSTS.has(new URL(request_url).hostname)) {
        headers["Strict-Transport-Security"] = "max-age=31536000"
    }
    return headers
}

// The hosts a browser reaches this computer by, which never get HSTS
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])

const app = new Hono()
    // Every answer with the security headers, set on a copy, since an
    // answer's own headers can be immutable, as a redirect's are. An
    // answer that sets its own Content-Security-Policy, like a dev
    // server's file (backend/files/send.ts), keeps it.
    .use(async (context, next) => {
        await next()
        const headers = new Headers(context.res.headers)
        for (const [name, value] of Object.entries(
            securityHeaders(context.req.url)
        )) {
            if (!headers.has(name)) {
                headers.set(name, value)
            }
        }
        context.res = new Response(context.res.body, {
            status: context.res.status,
            statusText: context.res.statusText,
            headers
        })
    })
    // A host with no files of its own skips them
    .use(async (context, next) => {
        if (hosts_without_files.has(new URL(context.req.url).host)) {
            return await rendered(context.req.raw)
        } else {
            await next()
        }
    })
    // Relative to where `pnpm start` runs: the repository's root
    .use(
        serveStatic({
            root: "output/client",
            onFound: (file, context) => {
                context.header(
                    "Cache-Control",
                    cacheControl(context.req.path, file)
                )
                nameFileRequest(context.req.method, context.req.path)
            }
        })
    )
    // Anything else is rendered on request
    .all("*", (context) => rendered(context.req.raw))

const server = serve(
    { fetch: app.fetch, port: Number(process.env.PORT ?? 3000) },
    (address) => console.info("Server listening", { port: address.port })
)

// The internal users, made to follow the list in code
// (source/backend/auth/access.ts), and the workflows, once the server is
// answering: while a deploy goes out the workflows wait for the old
// deployment's gate, and the healthcheck has to answer meanwhile for
// Railway to stop the old one (source/backend/workflows/)
built.syncAppInternalUsers()
built.startWorkflows()

// Railway stops the old deployment with SIGTERM once a new one is healthy:
// stop the workflows first, which lets the new one's start, then finish the
// requests in flight, send the spans not yet sent (source/tracing.ts), and
// exit. Once, however many signals come: pnpm
// passes its own on, so a signal to both is two here, and a second stop
// mustn't exit while the first is still shutting DBOS down.
// How long the stop takes at most, under Railway's 30 seconds
const STOP_DEADLINE_MS = 25_000

let stopping = false
process.on("SIGTERM", async () => {
    if (stopping) {
        return
    }
    stopping = true
    console.info("Server stopping")
    // Railway kills the process 30 seconds after the signal
    // (`drainingSeconds`, .railway/railway.ts): give up a little before,
    // so what's left is logged rather than cut off
    setTimeout(() => {
        console.error("The server didn't stop in time, so it's exiting")
        process.exit(1)
    }, STOP_DEADLINE_MS).unref()
    try {
        await built.stopWorkflows()
    } catch (error) {
        console.error("The workflows didn't stop cleanly", { error })
    }
    server.close(async () => {
        await stopTracing()
        process.exit(0)
    })
})
