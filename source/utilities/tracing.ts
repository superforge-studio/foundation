import {
    context,
    createContextKey,
    type Span,
    SpanStatusCode,
    trace
} from "@opentelemetry/api"
import { ATTR_HTTP_ROUTE } from "@opentelemetry/semantic-conventions"
import type { Context, MiddlewareHandler } from "hono"
import { routePath } from "hono/route"

/**
 * What the server's traces can't know on their own, which the app tells
 * them: each request's route, the app's own spans, and what failed
 * (workbench/writing-code.md, "Logging and tracing"). source/tracing.ts
 * turns tracing on, in the Node server on Railway; anywhere it's off, a dev
 * server or a test, each of these does nothing, since OpenTelemetry's API
 * makes no spans until something takes them.
 *
 * Only the server uses it, never a page: it's here, among what both sides
 * share, so any part of the server that answers requests, not only
 * `backend/`, names them the same way.
 */

/** The tracer the app's own spans are made with. */
export const tracer = trace.getTracer("app")

/**
 * Whether this process traces: source/tracing.ts has started, and with it
 * the context that carries the running span through each `await`, which
 * nothing else sets. DBOS makes its spans only when it does
 * (backend/workflows/engine.ts).
 */
export function tracingOn() {
    const probe = createContextKey("app.tracing-probe")
    return context.with(
        context.active().setValue(probe, true),
        () => context.active().getValue(probe) === true
    )
}

// The spans a route named itself, which `traceRoutes` leaves as it named
// them
const named_by_route = new WeakSet<Span>()

/**
 * Names a request's span, the running one unless it says, for its route,
 * `GET /api/workflows/runs/:id`, which Railway's Traces page searches with
 * `@http.route`, rather than the method alone that's all Node's `http`
 * knows of it. `traceRoutes` does it for every Hono route; a route that
 * answers many addresses at once, like a `*`, says better.
 */
export function nameRequest(
    method: string,
    route: string,
    span = trace.getActiveSpan()
) {
    if (span !== undefined) {
        nameSpan(span, method, route)
        named_by_route.add(span)
    }
}

function nameSpan(span: Span, method: string, route: string) {
    span.updateName(`${method} ${route}`)
    span.setAttribute(ATTR_HTTP_ROUTE, route)
}

// Set while a request's own span is named for its Hono route, so a request
// the MCP's tool makes of the API in-process, inside it (backend/mcp/),
// gets a span of its own rather than renaming the one it's in
const NAMED = createContextKey("app.request-named")

// The route that answered a request, as its app wrote it, with its
// parameters (`/api/workflows/runs/:id`): its handler's, or a middleware's on it
// that answered first, like `loggedIn`'s. A request no route matched has
// its app's own middleware's, like `/api/*`.
function answeredBy(hono: Context) {
    return routePath(hono)
}

/**
 * Hono middleware, first in each app the server hands requests to
 * (source/server.ts), that names the request's span for the route that
 * answered it, unless the route named it itself (`nameRequest`). A request
 * made in-process, inside another one's span, gets a span of its own,
 * named the same way.
 */
export const traceRoutes: MiddlewareHandler = async (hono, next) => {
    const active = context.active()
    const span = trace.getSpan(active)
    if (span === undefined) {
        await next()
    } else if (active.getValue(NAMED) === undefined) {
        try {
            await context.with(active.setValue(NAMED, true), next)
        } finally {
            if (!named_by_route.has(span)) {
                nameSpan(span, hono.req.method, answeredBy(hono))
            }
        }
    } else {
        await tracer.startActiveSpan(
            `${hono.req.method} ${hono.req.path}`,
            async (inner) => {
                try {
                    await next()
                } finally {
                    if (!named_by_route.has(inner)) {
                        nameSpan(inner, hono.req.method, answeredBy(hono))
                    }
                    inner.end()
                }
            }
        )
    }
}

/**
 * Marks the running span failed, with the error and its stack, which
 * Railway's Traces page finds with `@status:error`: for a route that threw
 * (backend/failures.ts), or anything else that failed in a way no caller
 * handles. Logging it is still the caller's.
 */
export function recordError(error: unknown) {
    const span = trace.getActiveSpan()
    if (span !== undefined) {
        markFailed(span, error)
    }
}

function markFailed(span: Span, error: unknown) {
    if (error instanceof Error) {
        span.recordException(error)
        span.setStatus({ code: SpanStatusCode.ERROR, message: error.message })
    } else {
        span.recordException(String(error))
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) })
    }
}

/**
 * Runs `work` in a span of its own, named `name`, inside whatever span is
 * running, or as a trace of its own outside any: for work worth seeing on
 * its own in a trace, like a runner's turn (backend/workflows/runners.ts).
 * A request, a workflow's run and its steps have theirs already. One that
 * throws marks its span failed, and throws on.
 */
export function traced<Result>(
    name: string,
    work: () => Promise<Result>
): Promise<Result> {
    return tracer.startActiveSpan(name, async (span) => {
        try {
            return await work()
        } catch (error) {
            markFailed(span, error)
            throw error
        } finally {
            span.end()
        }
    })
}
