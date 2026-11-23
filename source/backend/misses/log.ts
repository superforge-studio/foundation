import { signatureHeaders, sortMiss } from "./sort"

// Every request nothing answers, and every one that fails, logged, so an
// agent reading the logs (`railway logs`) finds what's trying to reach the
// app and can't: a webhook sent to the wrong address, a link to a page that
// isn't there, a route the app's own client still calls, a page that broke.
// source/server.ts logs what every handler answers, and the API says itself
// when no route answers a path (backend/failures.ts).
//
// Each is one line, its facts as JSON beside a static message, since
// Railway keeps each line of a log as an entry of its own: a search for the
// message finds the whole of each. Its query string never is, nor any
// header's value but the few that say who sent it and what, since either
// can carry a secret.

/**
 * A request nothing answers, logged unless it's a scanner's probe
 * (sort.ts): as a warning when it looks meant for the app, with why, and as
 * information otherwise. `status` is what it was answered: 404 for an
 * address nothing has, 405 for a page sent something other than a GET
 * (source/server.ts).
 */
export function logMiss(request: Request, status: 404 | 405) {
    const sorted = sortMiss(request)
    if (sorted.kind === "probe") {
        return
    } else if (sorted.kind === "meant-for-app") {
        console.warn(
            "A request missed that looks meant for the app",
            JSON.stringify({
                ...facts(request),
                status,
                because: sorted.because
            })
        )
    } else {
        console.info(
            "A request missed",
            JSON.stringify({ ...facts(request), status })
        )
    }
}

/**
 * A request answered with a server error (500 or more), logged whatever it
 * was. What went wrong is logged where it happened, like a route that threw
 * (backend/failures.ts): this says which request it was.
 */
export function logFailure(request: Request, status: number) {
    console.error(
        "A request failed",
        JSON.stringify({ ...facts(request), status })
    )
}

/** What the request says of itself that tells who sent it, and what */
function facts(request: Request) {
    const url = new URL(request.url)
    const signatures = signatureHeaders(request)
    return {
        method: request.method,
        host: url.host,
        path: url.pathname,
        user_agent: request.headers.get("User-Agent") ?? undefined,
        referrer: withoutQuery(request.headers.get("Referer")),
        content_type: request.headers.get("Content-Type") ?? undefined,
        size: bodySize(request),
        signatures: signatures.length > 0 ? signatures : undefined
    }
}

/** How many bytes the body is, as the request says, if it does */
function bodySize(request: Request) {
    const length = Number(request.headers.get("Content-Length") ?? Number.NaN)
    return Number.isInteger(length) ? length : undefined
}

/** A referring address without its query string, which can carry a token */
function withoutQuery(address: string | null) {
    if (address === null || !URL.canParse(address)) {
        return undefined
    } else {
        const url = new URL(address)
        return `${url.origin}${url.pathname}`
    }
}
