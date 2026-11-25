// Whom the site remembers between visits: the owner's choice, which
// START-HERE.md sets. The server applies it to every batch of the pages'
// events (backend/visits/), by each visitor's answer and where they are,
// and tells the page whether to ask (backend/visits/README.md).

/** Each way the site can treat its visitors. */
export const VISITOR_MODES = ["remember", "ask-in-eu", "ask", "never"] as const
export type VisitorMode = (typeof VISITOR_MODES)[number]

/**
 * Whom the site remembers, by a lasting `visitor` cookie its server sets:
 *
 * - `"remember"`, as it ships: everyone who hasn't declined, with no
 *   banner.
 * - `"ask-in-eu"`: the banner asks visitors where GDPR applies (the EU,
 *   the EEA and the UK, by their IP address, and anyone the server can't
 *   place), and everyone else is remembered: for a business outside the
 *   EU that cares.
 * - `"ask"`: the banner asks everyone, and only those who accept are
 *   remembered: for a business based in the EU.
 * - `"never"`: no one is remembered and no one is asked, and the server
 *   sets no cookie.
 *
 * A visitor who isn't remembered is still counted, as one visitor a day
 * (frontend/visitors/README.md).
 */
export const VISITOR_MODE: VisitorMode = "remember"

/**
 * Where an event came from: a page, through /api/visits, or the server
 * itself, which records what only it knows, like a sign-up.
 */
export const EVENT_SOURCES = ["browser", "server"] as const

/** The kinds of device a visitor's browser says it's on. */
export const DEVICES = ["mobile", "tablet", "desktop"] as const
export type Device = (typeof DEVICES)[number]

/**
 * The credit a screen owes wherever it shows where visitors were, like a
 * map of them or a list of countries: the places come from DB-IP's
 * database (backend/visits/location.ts), which is free under CC BY 4.0 as
 * long as what shows them links back.
 */
export const LOCATION_CREDIT = {
    text: "IP Geolocation by DB-IP",
    url: "https://db-ip.com"
} as const
