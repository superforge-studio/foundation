import type { Context } from "hono"
import { deleteCookie, getCookie, setCookie } from "hono/cookie"
import type { CookieOptions } from "hono/utils/cookie"
import { DAY } from "@/utilities/primitives/durations"
import { browser_id } from "@/utilities/schemas/events"
import {
    type VisitorConsent,
    visitor_consent
} from "@/utilities/schemas/visits"
import { secureCookie } from "../auth/logged-in"

// What the app keeps on a visitor's browser, as two first-party cookies
// its server sets, never a script: Safari deletes what a page's script
// stores after a week without a visit, and a page here stores nothing.
// Neither cookie is sent anywhere but this site, and a page's script can't
// read either.
//
// | Cookie            | Holds                          | Set when                                 |
// | ----------------- | ------------------------------ | ---------------------------------------- |
// | `visitor`         | Their lasting ID, a UUID       | The site remembers them (record.ts)      |
// | `visitor_consent` | `given` or `declined`          | They answer the banner                   |

const VISITOR = "visitor"
const CONSENT = "visitor_consent"

/**
 * How long each lasts after it's set or renewed: 400 days, the longest
 * Chrome keeps a cookie. Each batch of a remembered visitor's events
 * renews `visitor`, so it lasts 400 days from their last visit.
 */
export const COOKIE_LIFETIME = 400 * DAY

// Sent when someone follows a link here, but not with a request another
// site's page makes, and never read by a script
function cookieOptions(context: Context): CookieOptions {
    return {
        httpOnly: true,
        secure: secureCookie(context.req.url),
        sameSite: "Lax",
        path: "/",
        maxAge: COOKIE_LIFETIME / 1000
    }
}

/**
 * The visitor's lasting ID, from their `visitor` cookie: undefined without
 * one, and null with one that isn't an ID's shape, which a remembered
 * visitor's next answer replaces.
 */
export function keptVisitorId(context: Context) {
    const kept = getCookie(context, VISITOR)
    if (kept === undefined) {
        return undefined
    } else {
        const parsed = browser_id.safeParse(kept)
        return parsed.success ? parsed.data : null
    }
}

/** Sets the visitor's `visitor` cookie to `id`, or renews it. */
export function rememberVisitor(context: Context, id: string) {
    setCookie(context, VISITOR, id, cookieOptions(context))
}

/** Clears the visitor's `visitor` cookie. */
export function forgetVisitor(context: Context) {
    deleteCookie(context, VISITOR, {
        path: "/",
        secure: secureCookie(context.req.url)
    })
}

/**
 * What the visitor answered the banner, from their `visitor_consent`
 * cookie, or `unasked` without one, or with one that isn't an answer.
 */
export function keptConsent(context: Context) {
    const parsed = visitor_consent.safeParse(getCookie(context, CONSENT))
    return parsed.success ? parsed.data : "unasked"
}

/** Keeps what the visitor answered the banner in `visitor_consent`. */
export function keepConsent(context: Context, consent: VisitorConsent) {
    setCookie(context, CONSENT, consent, cookieOptions(context))
}
