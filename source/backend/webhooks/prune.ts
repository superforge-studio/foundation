import { inArray, lt } from "drizzle-orm"
import type { Database } from "@/database"
import { webhook_deliveries } from "@/database/schema"
import { fromNow } from "@/database/time"
import { DAY } from "@/utilities/primitives/durations"

// How long the webhooks other services posted are kept, and what deletes
// what's older, which the `prune-webhook-deliveries` workflow runs each
// hour (workflows.ts). A delivery is for reading back what came, or
// why it was refused; what it meant is in the runs it queued.

/**
 * How long a delivery is kept after it came, or `"forever"`: long enough
 * to find one a sender says it sent, since Stripe retries for three days
 * and most give up sooner.
 */
export const KEEP_DELIVERIES_FOR: number | "forever" = 30 * DAY

// How many rows one statement deletes, and how many statements a turn runs
// at most, so a turn is short: what's left goes on the next turn
const BATCH = 1000
const BATCHES_A_TURN = 20

/**
 * Deletes the deliveries older than `keep`, a batch at a time, and
 * answers how many.
 */
export async function pruneDeliveries(
    database: Database,
    keep: number | "forever" = KEEP_DELIVERIES_FOR
) {
    if (keep === "forever") {
        return 0
    }
    let deleted = 0
    for (let batch = 0; batch < BATCHES_A_TURN; batch++) {
        const old = database
            .select({ id: webhook_deliveries.id })
            .from(webhook_deliveries)
            .where(lt(webhook_deliveries.received_at, fromNow(-keep)))
            .limit(BATCH)
        const gone = await database
            .delete(webhook_deliveries)
            .where(inArray(webhook_deliveries.id, old))
            .returning({ id: webhook_deliveries.id })
        deleted += gone.length
        if (gone.length < BATCH) {
            break
        }
    }
    return deleted
}
