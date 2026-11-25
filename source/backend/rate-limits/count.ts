import { createHash } from "node:crypto"
import { lt, sql } from "drizzle-orm"
import type { Database } from "@/database"
import { rate_limits } from "@/database/schema"
import { fromNow } from "@/database/time"
import { DAY, HOUR } from "@/utilities/primitives/durations"
import { networkOf } from "../visits/visitors"

// How often one network does something that's limited, so a script posting
// to a route anyone may call, like a form's, can't fill the database with
// junk: a count over a window in `internal.rate_limits`, by a hash of the
// network, never the address itself, counted in the database so every
// server and every deploy count together. A route counts each attempt with
// `countAttempt` before it does anything, and answers 429 with the
// `retry_after` it's given when the count is past what it allows:
//
//   const counted = await countAttempt(context.var.database, {
//       bucket: "forms",
//       key: networkKey(visitor_ip),
//       most: 10
//   })
//   if (!counted.ok) {
//       context.header("Retry-After", String(counted.error.retry_after))
//       return failure(context, 429, "too-many", "Too many forms; try again later")
//   }
//
// An attempt can count as more than one, by its `amount`, as a batch of a
// page's events counts as its events (visits/limit.ts).

/**
 * What `ip`'s network is counted by: a hash of it, as visitors.ts counts a
 * network (an IPv4 address itself, an IPv6 one's /64, which a household or
 * a phone is handed whole), or of the address itself when it isn't one.
 */
export function networkKey(ip: string) {
    return createHash("sha256")
        .update(networkOf(ip) ?? ip)
        .digest("hex")
}

/**
 * Counts `amount` more of `bucket`, what's limited (one unless it says),
 * from `key`, who did it, in the window it's in, `window` from its first
 * (an hour unless it says), and refuses it once the count is past `most`,
 * with how many seconds until the window ends and the count, which a
 * refused attempt adds to as well. Windows that ended a day ago are
 * deleted as it goes.
 */
export async function countAttempt(
    database: Database,
    {
        bucket,
        key,
        most,
        window = HOUR,
        amount = 1
    }: {
        bucket: string
        key: string
        most: number
        window?: number
        amount?: number
    }
): AsyncOperationResult<
    { count: number },
    { retry_after: number; count: number }
> {
    const ended = sql`${rate_limits.window_started_at} <= ${fromNow(-window)}`
    const [counted] = await database
        .insert(rate_limits)
        .values({ bucket, key, window_started_at: sql`now()`, count: amount })
        .onConflictDoUpdate({
            target: [rate_limits.bucket, rate_limits.key],
            set: {
                count: sql`case when ${ended} then ${amount}::integer else ${rate_limits.count} + ${amount}::integer end`,
                window_started_at: sql`case when ${ended} then now() else ${rate_limits.window_started_at} end`
            }
        })
        .returning({
            count: rate_limits.count,
            // Seconds until its window ends, by the database's clock
            ends_in: sql<number>`ceil(extract(epoch from (${rate_limits.window_started_at} + make_interval(secs => ${window / 1000}) - now())))::integer`
        })
    await database
        .delete(rate_limits)
        .where(lt(rate_limits.window_started_at, fromNow(-DAY)))
    if (counted === undefined) {
        throw new Error("A rate limit wasn't counted")
    } else if (counted.count > most) {
        return {
            ok: false,
            error: {
                retry_after: Math.max(1, counted.ends_in),
                count: counted.count
            }
        }
    } else {
        return { ok: true, data: { count: counted.count } }
    }
}
