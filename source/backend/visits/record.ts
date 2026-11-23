import { randomUUID } from "node:crypto"
import { and, desc, eq, isNull, sql } from "drizzle-orm"
import { z } from "zod"
import type { Database } from "@/database"
import { analytics_events, analytics_visits } from "@/database/schema"
import type { Storage } from "@/database/storage"
import { DAY, MINUTE } from "@/utilities/primitives/durations"
import {
    browser_id,
    event_name,
    event_properties,
    page_path
} from "@/utilities/schemas/events"
import type { PageEvent } from "@/utilities/schemas/visits"
import type { VisitorMode } from "@/utilities/visitors"
import { describeBrowser } from "./browsers"
import type { Locate } from "./location"
import { summarizeVisits } from "./summarize"
import {
    addressToKeep,
    anonymousVisitor,
    type Consent,
    whomToRemember
} from "./visitors"

// Keeping what happened on the site, in the app's own database
// (`analytics_visits` and `analytics_events`): a visitor's page events,
// each in its visit, and what only the server knows. README.md has the
// rules.

/** How long a visit lasts with nothing happening. */
export const VISIT_GAP = 30 * MINUTE

/** How old a page's event can be and still be kept. */
export const OLDEST_PAGE_EVENT = 7 * DAY

// The first key of the advisory lock that keeps one visitor's batches in
// turn, with the visitor's hash as the second: a pair nothing else takes
// (the workflows' gate is 1689, backend/workflows/engine.ts)
const VISITOR_LOCK = 1690

/**
 * One visitor's page events, as their page sent them to /api/visits, with
 * who the server says they are.
 */
export type PageVisit = {
    /** Whom the site remembers (utilities/visitors.ts) */
    mode: VisitorMode
    visitor: {
        /**
         * The ID in their `visitor` cookie, or a new one the site would
         * set: null when it never would, in `never` mode
         */
        id: string | null
        /** What they answered the banner */
        consent: Consent
        /** Whoever is logged in */
        user_id: string | null
        /**
         * For their country, kept on their visit when they're remembered,
         * and to count them when they aren't
         */
        ip: string
        /** For bots, and what they're on */
        user_agent: string
    }
    /** When the page sent the batch, in milliseconds by the browser's clock */
    sent_at: number
    events: PageEvent[]
}

/**
 * Keeps a visitor's page events, each in its visit, and answers whether
 * the site remembers the visitor, so its server sets, keeps or clears
 * their `visitor` cookie, and whether their page asks them first, by the
 * site's mode, their answer and their country.
 *
 * A remembered visitor's events are kept under their ID, with whoever is
 * logged in, and their visit with their IP address. One who isn't is kept
 * under the day's hash, with no user and no address. Nobody's User-Agent
 * is kept: their country, and what they're on, are read as the visit
 * starts. A bot's events are answered and dropped, and so are events more
 * than a week old.
 */
export async function recordVisit(
    {
        database,
        storage,
        locate
    }: { database: Database; storage: Storage; locate: Locate },
    { mode, visitor, sent_at, events }: PageVisit
) {
    const browser = describeBrowser(visitor.user_agent)
    if (browser === null) {
        return { kept: 0, remembered: false, ask: false }
    }
    const place = locate(visitor.ip)
    const decided = whomToRemember(
        mode,
        visitor.consent,
        place?.country ?? null
    )
    // Only an ID the cookie holds, or would, can be remembered
    const remembered_id = decided.remembered ? visitor.id : null
    const answer = { remembered: remembered_id !== null, ask: decided.ask }

    // Each event's time by the server's clock: the browser's, less how far
    // ahead it runs, and never in the future
    const received = Date.now()
    const skew = sent_at - received
    const timed = events
        .map((event) => ({
            ...event,
            occurred_at: new Date(Math.min(event.at - skew, received))
        }))
        .filter(
            (event) =>
                event.occurred_at.getTime() >= received - OLDEST_PAGE_EVENT
        )
        .sort(
            (one, other) =>
                one.occurred_at.getTime() - other.occurred_at.getTime()
        )
    if (timed.length === 0) {
        return { kept: 0, ...answer }
    }

    const visitor_id =
        remembered_id ??
        (await anonymousVisitor(storage, {
            ip: visitor.ip,
            user_agent: visitor.user_agent
        }))
    // A remembered visitor's user and address: one who isn't is only the
    // day's hash, which either beside it would undo
    const user_id = remembered_id === null ? null : visitor.user_id
    const ip_address = remembered_id === null ? null : addressToKeep(visitor.ip)

    await database.transaction(async (transaction) => {
        // One visitor's batches in turn, so two that arrive together, like
        // two tabs', join one visit rather than each starting its own
        await transaction.execute(
            sql`select pg_advisory_xact_lock(${VISITOR_LOCK}, hashtext(${visitor_id}))`
        )

        // Their latest visit, which the first of these events joins when
        // the two are 30 minutes apart or less
        const [latest] = await transaction
            .select({
                id: analytics_visits.id,
                ended_at: analytics_visits.ended_at
            })
            .from(analytics_visits)
            .where(eq(analytics_visits.visitor_id, visitor_id))
            .orderBy(desc(analytics_visits.ended_at))
            .limit(1)

        // Each event's visit: the one of the event before it, theirs
        // already kept or one of these, or a new one after a gap
        const started: { id: string; at: Date }[] = []
        const rows: (typeof analytics_events.$inferInsert)[] = []
        let joins_latest = false
        let current =
            latest === undefined
                ? null
                : { id: latest.id, at: latest.ended_at.getTime() }
        for (const event of timed) {
            const at = event.occurred_at.getTime()
            if (current !== null && Math.abs(at - current.at) <= VISIT_GAP) {
                current = { id: current.id, at }
                joins_latest ||= current.id === latest?.id
            } else {
                current = { id: randomUUID(), at }
                started.push({ id: current.id, at: event.occurred_at })
            }
            rows.push({
                source: "browser",
                name: event.name,
                visit_id: current.id,
                visitor_id,
                user_id,
                path: event.path,
                properties: event.properties,
                occurred_at: event.occurred_at
            })
        }

        // The visits these events start, with where the visitor is and what
        // they're on, read now and kept in place of the User-Agent they were
        // read from, and a remembered visitor's address
        if (started.length > 0) {
            await transaction.insert(analytics_visits).values(
                started.map(({ id, at }) => ({
                    id,
                    visitor_id,
                    anonymous: remembered_id === null,
                    user_id,
                    // Until the visit is worked out from its events, below
                    started_at: at,
                    ended_at: at,
                    ip_address,
                    country: place?.country ?? null,
                    region: place?.region ?? null,
                    city: place?.city ?? null,
                    device: browser.device,
                    browser: browser.browser,
                    os: browser.os
                }))
            )
        }
        // A visit they began logged out, and have logged in during
        if (latest !== undefined && joins_latest && user_id !== null) {
            await transaction
                .update(analytics_visits)
                .set({ user_id })
                .where(
                    and(
                        eq(analytics_visits.id, latest.id),
                        isNull(analytics_visits.user_id)
                    )
                )
        }
        await transaction.insert(analytics_events).values(rows)
        await summarizeVisits(transaction, [
            ...(latest !== undefined && joins_latest ? [latest.id] : []),
            ...started.map((visit) => visit.id)
        ])
    })
    return { kept: timed.length, ...answer }
}

/**
 * Something that happened which only the server knows, like a sign-up, a
 * booking or a payment: its name, and whatever else is known of it. `at`
 * is when it happened, now when it's left out; `user_id` whoever it's
 * about; `visitor_id` the ID in their `visitor` cookie, when the server has
 * it, which joins the event to their visits.
 */
export const server_event = z.object({
    name: event_name,
    at: z.date().optional(),
    path: page_path.optional(),
    visitor_id: browser_id.optional(),
    user_id: z.uuid().optional(),
    properties: event_properties.optional()
})
export type ServerEvent = z.input<typeof server_event>

/**
 * Keeps what the server says happened, and answers how many events it
 * kept. One that isn't an event's shape is a bug where it's recorded, so
 * it throws, as a database that's down does. An event is never worth
 * failing a request over: where a person is waiting, catch what this
 * throws and log it.
 */
export async function recordEvents(database: Database, events: ServerEvent[]) {
    const now = new Date()
    const rows = z
        .array(server_event)
        .parse(events)
        .map((event) => ({
            source: "server" as const,
            name: event.name,
            visitor_id: event.visitor_id ?? null,
            user_id: event.user_id ?? null,
            path: event.path ?? null,
            properties: event.properties ?? {},
            occurred_at: event.at ?? now
        }))
    if (rows.length > 0) {
        await database.insert(analytics_events).values(rows)
    }
    return rows.length
}
