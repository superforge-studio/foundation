// What a request nothing answers looks like: a scanner's probe, which every
// site gets and the log leaves out, one that looks meant for the app, and
// why, or neither (log.ts)

/**
 * Why a request nothing answers looks meant for the app, rather than a
 * crawler's or a scanner's guess:
 *
 * - `signed`: it carries a header like a webhook's signature
 *   (`Stripe-Signature`, `X-Hub-Signature-256`, `Svix-Signature`,
 *   `Webhook-Signature`, `X-Shopify-Hmac-Sha256`): a service sending what
 *   it was set up to send, to an address that isn't the app's
 * - `json`: it sends a JSON body, as a webhook does, or the app's own client
 * - `api`: it's under /api, which only the app's own pages and scripts,
 *   Claude and the services it's set up with call: a route that moved, or
 *   a typo in an address
 * - `linked`: the page it came from is on the same host, so the site links
 *   to a page or a file it doesn't have
 */
export type MissReason = "signed" | "json" | "api" | "linked"

export type SortedMiss =
    | { kind: "probe" }
    | { kind: "meant-for-app"; because: MissReason[] }
    | { kind: "other" }

/**
 * What scanners try on every site, looking for a way in: PHP, ASP and CGI
 * scripts, WordPress, dotfiles like `/.env` and `/.git/config`, backups and
 * dumps, and the admin panels of software the app doesn't run. A path is a
 * probe when any of its parts matches one, unless it's signed like a
 * webhook. `/.well-known/` isn't: what's under it is asked for by services
 * the app may use, like Claude signing in (backend/agents/oauth.ts).
 */
const PROBES = [
    /\.(php\d?|phtml|aspx?|ashx|asmx|jsp|cgi|env|ini|sql|bak|old|orig|swp)$/i,
    /^(wp|wordpress|wp-.*)$/i,
    /^\.(?!well-known$)/,
    /^(cgi-bin|phpmyadmin|pma|myadmin|phpunit|boaform|hnap1|actuator|autodiscover|owa|ecp)$/i
]

/** The headers a webhook signs what it sends with, by their names */
const SIGNATURE = /signature|hmac|webhook/i

/** How a request nothing answers looks, by its address and headers alone */
export function sortMiss(request: Request): SortedMiss {
    const url = new URL(request.url)
    const signed = signatureHeaders(request).length > 0
    const probe = url.pathname
        .split("/")
        .some((part) => PROBES.some((pattern) => pattern.test(part)))
    if (probe && !signed) {
        return { kind: "probe" }
    }
    const because: MissReason[] = []
    if (signed) {
        because.push("signed")
    }
    if (sendsJson(request)) {
        because.push("json")
    }
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
        because.push("api")
    }
    if (cameFrom(request) === url.host) {
        because.push("linked")
    }
    if (because.length > 0) {
        return { kind: "meant-for-app", because }
    } else {
        return { kind: "other" }
    }
}

/** The names of the headers that look like a webhook's signature, never their values */
export function signatureHeaders(request: Request) {
    return [...request.headers.keys()].filter((name) => SIGNATURE.test(name))
}

function sendsJson(request: Request) {
    const content_type = request.headers.get("Content-Type") ?? ""
    return (
        request.method !== "GET" &&
        request.method !== "HEAD" &&
        /json/i.test(content_type)
    )
}

/** The host of the page the request came from, if it says */
function cameFrom(request: Request) {
    const referrer = request.headers.get("Referer")
    if (referrer === null || !URL.canParse(referrer)) {
        return null
    } else {
        return new URL(referrer).host
    }
}
