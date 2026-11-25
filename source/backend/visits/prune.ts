import { and, inArray, isNotNull, lt } from "drizzle-orm"
import type { Database } from "@/database"
import { analytics_events, analytics_visits } from "@/database/schema"
import { fromNow } from "@/database/time"
import { HOUR } from "@/utilities/primitives/durations"
import { SETTINGS } from "@/utilities/settings"
import type { Runner } from "../workflows/runners"

// How long the site's analytics is kept, as the app's settings say
// (`keep_events_for`, `keep_ip_addresses_for` and `keep_visits_for`,
// utilities/settings/), and the runner that deletes what's older and
// blanks the IP addresses. As the template ships, the visits and their
// events are kept for good, and only a remembered visitor's address goes,
// after 90 days. A copy that keeps less has the events go first, since
// they're the bulk of it and say the most about one visitor, and a visit,
// a row with what its events came to, stay for the reports that look back
// further.

/**
 * How long an event is kept after it happened, or `"forever"`. Every
 * report over events reads this far back at most.
 */
export const KEEP_EVENTS_FOR = SETTINGS.keep_events_for

/**
 * How long a remembered visitor's IP address is kept on their visit after
 * it started, or `"forever"`, after which it's blanked and the visit stays.
 */
export const KEEP_IP_ADDRESSES_FOR = SETTINGS.keep_ip_addresses_for

/** How long a visit is kept after it started, or `"forever"`. */
export const KEEP_VISITS_FOR = SETTINGS.keep_visits_for

// How many rows one statement deletes, and how many statements a turn runs
// at most, so a turn is short and holds no lock for long: what's left
// goes on the next turn
const BATCH = 5000
const BATCHES_A_TURN = 20

/** Deletes up to `limit` events that happened before `keep` ago, and answers how many. */
export async function deleteOldEvents(
    database: Database,
    { keep, limit }: { keep: number; limit: number }
) {
    const old = database
        .select({ id: analytics_events.id })
        .from(analytics_events)
        .where(lt(analytics_events.occurred_at, fromNow(-keep)))
        .limit(limit)
    const deleted = await database
        .delete(analytics_events)
        .where(inArray(analytics_events.id, old))
        .returning({ id: analytics_events.id })
    return deleted.length
}

/**
 * Blanks the IP address of up to `limit` visits that started before `keep`
 * ago, and answers how many.
 */
export async function forgetOldAddresses(
    database: Database,
    { keep, limit }: { keep: number; limit: number }
) {
    const old = database
        .select({ id: analytics_visits.id })
        .from(analytics_visits)
        .where(
            and(
                isNotNull(analytics_visits.ip_address),
                lt(analytics_visits.started_at, fromNow(-keep))
            )
        )
        .limit(limit)
    const forgotten = await database
        .update(analytics_visits)
        .set({ ip_address: null })
        .where(inArray(analytics_visits.id, old))
        .returning({ id: analytics_visits.id })
    return forgotten.length
}

/**
 * Deletes up to `limit` visits that started before `keep` ago, with any
 * events they still have, and answers how many visits.
 */
export async function deleteOldVisits(
    database: Database,
    { keep, limit }: { keep: number; limit: number }
) {
    const old = database
        .select({ id: analytics_visits.id })
        .from(analytics_visits)
        .where(lt(analytics_visits.started_at, fromNow(-keep)))
        .limit(limit)
    const deleted = await database
        .delete(analytics_visits)
        .where(inArray(analytics_visits.id, old))
        .returning({ id: analytics_visits.id })
    return deleted.length
}

/**
 * Deletes the events and the visits older than they're kept, and blanks
 * the IP addresses older than they're kept, a batch at a time, and answers
 * how many of each: by `KEEP_EVENTS_FOR`, `KEEP_IP_ADDRESSES_FOR` and
 * `KEEP_VISITS_FOR`, or a test's own.
 */
export async function pruneAnalytics(
    database: Database,
    {
        events = KEEP_EVENTS_FOR,
        addresses = KEEP_IP_ADDRESSES_FOR,
        visits = KEEP_VISITS_FOR
    }: {
        events?: number | "forever"
        addresses?: number | "forever"
        visits?: number | "forever"
    } = {}
) {
    return {
        events:
            events === "forever"
                ? 0
                : await inBatches((limit) =>
                      deleteOldEvents(database, { keep: events, limit })
                  ),
        addresses:
            addresses === "forever"
                ? 0
                : await inBatches((limit) =>
                      forgetOldAddresses(database, { keep: addresses, limit })
                  ),
        visits:
            visits === "forever"
                ? 0
                : await inBatches((limit) =>
                      deleteOldVisits(database, { keep: visits, limit })
                  )
    }
}

// Runs `pruneBatch` until a batch comes back short, or the turn has run
// its share, and answers how many rows it deleted or blanked
async function inBatches(pruneBatch: (limit: number) => Promise<number>) {
    let pruned = 0
    for (let batch = 0; batch < BATCHES_A_TURN; batch++) {
        const last = await pruneBatch(BATCH)
        pruned += last
        if (last < BATCH) {
            break
        }
    }
    return pruned
}

/**
 * Each hour, deletes the analytics older than it's kept, and blanks the IP
 * addresses older than they're kept (backend/workflows/README.md,
 * "Runners").
 */
export const pruneAnalyticsRunner: Runner = {
    name: "prune-analytics",
    every: HOUR,
    run: async ({ database }) => {
        const pruned = await pruneAnalytics(database)
        if (pruned.events > 0 || pruned.addresses > 0 || pruned.visits > 0) {
            console.info("Old analytics deleted", pruned)
        }
    }
}
