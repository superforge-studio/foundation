import { DAY } from "../primitives/durations"
import type { VisitorMode } from "../visitors"
import { APP_SETTINGS } from "./app"

// Relative, since drizzle-kit reads this file through schema.ts, without
// the app's `@/` paths

// What a business decides about its app, which the code it runs on reads:
// the template's defaults below, with this app's own over them
// (./app.ts), where an update from the template never meets them. Each
// part reads its own (like `KEEP_EVENTS_FOR`, backend/visits/prune.ts)
// from `SETTINGS`, both sides alike.

/** Every setting there is, and what it does. */
export type Settings = {
    /**
     * The site's name, and a line on what the business does: every
     * page's title and description, unless the page sets its own
     * (frontend/routes/__root.tsx).
     */
    site_title: string
    site_description: string
    /**
     * Whom the site remembers between visits, by a lasting `visitor`
     * cookie its server sets (backend/visits/README.md):
     *
     * - `"remember"`: everyone who hasn't declined, with no banner.
     * - `"ask-in-eu"`: the banner asks visitors where GDPR applies (the
     *   EU, the EEA and the UK, by their IP address, and anyone the server
     *   can't place), and everyone else is remembered: for a business
     *   outside the EU that cares.
     * - `"ask"`: the banner asks everyone, and only those who accept are
     *   remembered: for a business based in the EU.
     * - `"never"`: no one is remembered and no one is asked, and the
     *   server sets no cookie.
     *
     * A visitor who isn't remembered is still counted, as one visitor a
     * day (frontend/visitors/README.md).
     */
    visitor_mode: VisitorMode
    /**
     * How long a workflow's finished run is kept, with its steps, for
     * reading back what it did, or `"forever"`. A run that finished longer
     * ago is pruned about once an hour (backend/workflows/engine.ts).
     */
    keep_finished_runs_for: number | "forever"
    /**
     * How long the site's analytics is kept (backend/visits/prune.ts), or
     * `"forever"`: an event after it happened, which every report over
     * events reads this far back at most; a remembered visitor's IP
     * address on their visit, after which it's blanked and the visit
     * stays; and a visit after it started, with a page's events on it.
     */
    keep_events_for: number | "forever"
    keep_ip_addresses_for: number | "forever"
    keep_visits_for: number | "forever"
    /**
     * How long a webhook another service posted is kept after it came, or
     * `"forever"` (backend/webhooks/prune.ts).
     */
    keep_webhook_deliveries_for: number | "forever"
    /**
     * Your files' limits (backend/files/): the largest file anyone
     * uploads, in bytes, how many days something stays in Trash before
     * it's deleted for good, and how many days a link from "Copy a link"
     * works.
     */
    largest_file: number
    trash_days: number
    link_days: number
}

/** The template's settings, which this app's own replace one by one. */
export const TEMPLATE_SETTINGS: Settings = {
    site_title: "Your business, in one codebase",
    site_description:
        "A website, an API and a database in one codebase, made to be changed with Claude.",
    visitor_mode: "remember",
    // For good, since a run and its steps are the record of what the
    // business's background work did. A copy whose runs grow too many for
    // its database sets a duration instead, like `90 * DAY`
    keep_finished_runs_for: "forever",
    // For good, the visits and every event on them, since they're the
    // record of what people did on the site, which a copy can show beside
    // what else it keeps of someone, like their messages, for as long as
    // it keeps that. A copy whose analytics outgrows its database, or that
    // keeps to the 25 months France's regulator (CNIL) says is the longest
    // to keep what a site measures of its audience, sets a duration
    // instead, like `760 * DAY`
    keep_events_for: "forever",
    // 90 days: an address says roughly where someone is, so it isn't kept
    // for good with the rest
    keep_ip_addresses_for: 90 * DAY,
    keep_visits_for: "forever",
    // Long enough to find one a sender says it sent, since Stripe retries
    // for three days and most give up sooner
    keep_webhook_deliveries_for: 30 * DAY,
    largest_file: 100 * 1024 * 1024,
    trash_days: 30,
    link_days: 7
}

/** This app's settings: the template's, with its own over them. */
export const SETTINGS: Settings = { ...TEMPLATE_SETTINGS, ...APP_SETTINGS }
