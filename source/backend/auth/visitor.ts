import type { Context } from "hono"
import { z } from "zod"

// What the server reads of a visitor from their request: who's logging in,
// for Infra (auth/routes.ts), and who sent a page's events, for the app's
// own analytics (visits/routes.ts)

/** An IPv4 or IPv6 address, as Infra takes one. */
export const ip_address = z.union([z.ipv4(), z.ipv6()])

/**
 * The visitor's IP address, which Infra's login limits count by, and
 * the server places a visitor's country by (visits/location.ts): the
 * `X-Real-IP` header Railway's proxy sets, since the connection's own
 * address is the proxy's. A request
 * without it, like one to a dev server or to the build on this computer,
 * counts as this computer's own.
 */
export function visitorIp(context: Context) {
    const parsed = ip_address.safeParse(context.req.header("X-Real-IP"))
    if (parsed.success) {
        return parsed.data
    } else {
        if (!import.meta.env.DEV) {
            console.warn(
                "A request came without Railway's X-Real-IP, so it counts as 127.0.0.1",
                {
                    path: context.req.path,
                    header: context.req.header("X-Real-IP") ?? null
                }
            )
        }
        return "127.0.0.1"
    }
}

/** The longest `User-Agent` read: what Infra takes with a comment. */
const LONGEST_USER_AGENT = 1024

/**
 * The browser, as it describes itself (`User-Agent`), which tells a bot
 * from a person and a phone from a laptop, and is never kept, by the
 * server (visits/browsers.ts) or by Infra with a comment: as it came,
 * shortened, or empty without one.
 */
export function visitorUserAgent(context: Context) {
    return (context.req.header("User-Agent") ?? "")
        .trim()
        .slice(0, LONGEST_USER_AGENT)
}

// The longest browser description kept with a session: a real one is a few
// hundred characters, and anything longer is someone padding it
const LONGEST_BROWSER = 512

/**
 * The browser, as it describes itself (`User-Agent`), kept with its
 * session so the account page can say where someone is logged in. Only
 * ever shown back to its own user, so it's kept as it came, shortened.
 */
export function visitorBrowser(context: Context) {
    const described = context.req.header("User-Agent")?.trim()
    if (described === undefined || described === "") {
        return null
    } else {
        return described.slice(0, LONGEST_BROWSER)
    }
}

/**
 * Where the app is, for the link in the login email: the request's own
 * origin. Infra builds the link only for a domain the project lists, or
 * localhost, so a forged Host header can't send anyone elsewhere; behind
 * Railway's proxy the origin says http, which Infra makes https.
 */
export function appOrigin(context: Context) {
    return new URL(context.req.url).origin
}
