// What this app's server answers itself, beside the template's
// (./server.ts): nothing, as the template ships. They're here so an update
// from the template never meets them. A page is a route file, and a route
// under /api is its feature's (backend/app.ts); this is for what's neither,
// like a short link's redirect or a file served from the bucket.

/**
 * The hosts whose every path the server answers, never one of the build's
 * files, like a domain kept for short links: the Node server sends their
 * requests straight to ./server.ts, past the files (./node.ts).
 */
export const HOSTS_WITHOUT_FILES: readonly string[] = []

/**
 * This app's own answer to a request that isn't for /api, asked before the
 * template's own paths and the pages, or null to leave it to them. It sees
 * every method, so it answers only what it means to.
 */
export function appAnswer(
    _request: Request,
    _url: URL
): Response | Promise<Response | null> | null {
    return null
}

/**
 * The route a page of this app's that's drawn on request is traced as,
 * like `/portal/*` for a dashboard of its own (utilities/tracing.ts), or
 * null for any other.
 */
export function appPageRoute(_pathname: string): string | null {
    return null
}
