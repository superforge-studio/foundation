import type { Database } from "@/database"
import { DAY } from "@/utilities/primitives/durations"
import type { PageEvent } from "@/utilities/schemas/visits"
import { countAttempt, networkKey } from "../rate-limits/count"

// How much of the pages' events one network may send in a day, so a
// script can't fill the database with them: counted by rate-limits/, a
// day from the network's first batch. README.md, "How much one network
// may send", has why the numbers are what they are.

/**
 * What one network may send in a day: 20,000, each batch counting as its
 * events, or as its kilobytes when that's more. A visit is a few dozen
 * events, so it's hundreds of visits from one address, an office's or a
 * café's, and at most about 20 MB of events.
 */
export const PAGE_EVENTS_A_DAY = 20_000

/** What a batch counts as: its events, or its kilobytes when that's more. */
export function batchCost(events: PageEvent[]) {
    const kilobytes = Math.ceil(
        Buffer.byteLength(JSON.stringify(events)) / 1024
    )
    return Math.max(events.length, kilobytes)
}

/**
 * Counts a batch of a page's events against its network's day
 * (`networkKey`, as login counts it: an IPv4 address, an IPv6 one's /64),
 * and refuses it past PAGE_EVENTS_A_DAY, with how many seconds until the
 * network's day ends. The batch that first takes a network past it is
 * logged, without who sent it.
 */
export async function countPageEvents(
    database: Database,
    { ip, events }: { ip: string; events: PageEvent[] }
): AsyncOperationResult<null, { retry_after: number }> {
    const amount = batchCost(events)
    const counted = await countAttempt(database, {
        bucket: "visits",
        key: networkKey(ip),
        most: PAGE_EVENTS_A_DAY,
        window: DAY,
        amount
    })
    if (counted.ok) {
        return { ok: true, data: null }
    } else if (counted.error.count - amount <= PAGE_EVENTS_A_DAY) {
        // The batch that took it past: logged once for the network's day
        console.warn(
            "A network sent more page events than a day allows, so the rest of its day's are refused",
            { retry_after: counted.error.retry_after }
        )
        return { ok: false, error: { retry_after: counted.error.retry_after } }
    } else {
        return { ok: false, error: { retry_after: counted.error.retry_after } }
    }
}
