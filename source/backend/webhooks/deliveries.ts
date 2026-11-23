import { eq } from "drizzle-orm"
import { z } from "zod"
import type { Database } from "@/database"
import { webhook_deliveries } from "@/database/schema"
import { queueEvent } from "../workflows/queue"
import type { Delivery, Refusal, WebhookSource } from "./sources"

// Taking a webhook another service posted: kept as it came, first, then
// checked to be its source's, then its events queued, each step's outcome
// written on its row (README.md, "A delivery").

// Headers kept off a delivery's row, since one would let someone in
const UNKEPT_HEADERS = new Set([
    "authorization",
    "cookie",
    "proxy-authorization"
])

/**
 * The events a delivery queued, as its `events` column keeps them: each
 * by its name, with the runs it queued. Read back through this, since an
 * older version may have written it.
 */
export const queued_events = z.array(
    z.object({ name: z.string(), runs: z.array(z.string()) })
)

/** What came of taking a delivery. */
export type Taken =
    | { outcome: "accepted"; events: z.infer<typeof queued_events> }
    | { outcome: "ignored" }

/**
 * Takes `delivery` from `source`: keeps it as it came, checks its
 * signature, reads its events and queues them, all in one transaction with
 * its outcome, so its runs are queued only if the row says so. Each event
 * is named for the sender's ID for the delivery, when it has one, so a
 * retry of it queues each workflow once. Answers what came of it, or why
 * it was refused, or what was wrong with its body. A failure to queue
 * throws, after writing `failed` on its row.
 */
export async function takeDelivery(
    database: Database,
    source: WebhookSource,
    delivery: Delivery
): AsyncOperationResult<
    Taken,
    Refusal | { reason: "unreadable"; problem: string }
> {
    const delivery_id = source.deliveryId(delivery)

    // Kept as it came, before anything else
    const [kept] = await database
        .insert(webhook_deliveries)
        .values({
            source: source.name,
            received_at: delivery.received_at,
            delivery_id,
            headers: keptHeaders(delivery.headers),
            body: delivery.body
        })
        .returning({ id: webhook_deliveries.id })
    if (kept === undefined) {
        throw new Error("A delivery's insert answered no row")
    }
    const settle = (
        settled: Partial<typeof webhook_deliveries.$inferInsert>,
        on: Database = database
    ) =>
        on
            .update(webhook_deliveries)
            .set(settled)
            .where(eq(webhook_deliveries.id, kept.id))

    // Its source's, or refused
    const verified = source.verify(delivery)
    if (!verified.ok) {
        await settle({ outcome: "refused", problem: verified.error.problem })
        return verified
    }

    // What it says, or what's wrong with it
    const read = source.events(delivery)
    if (!read.ok) {
        await settle({ outcome: "failed", problem: read.error })
        return {
            ok: false,
            error: { reason: "unreadable", problem: read.error }
        }
    }
    if (read.data.length === 0) {
        await settle({ outcome: "ignored" })
        return { ok: true, data: { outcome: "ignored" } }
    }

    // Its events queued, with its outcome, together
    try {
        const events = await database.transaction(async (transaction) => {
            const queued: z.infer<typeof queued_events> = []
            for (const [index, event] of read.data.entries()) {
                const id =
                    event.id ??
                    (delivery_id === null
                        ? undefined
                        : `${source.name}-${delivery_id}-${index}`)
                const runs = await queueEvent(
                    transaction,
                    event.name,
                    event.data,
                    { id }
                )
                queued.push({ name: event.name, runs })
            }
            await settle({ outcome: "accepted", events: queued }, transaction)
            return queued
        })
        return { ok: true, data: { outcome: "accepted", events } }
    } catch (error) {
        await settle({
            outcome: "failed",
            problem: `Its events weren't queued: ${error instanceof Error ? error.message : String(error)}`
        })
        throw error
    }
}

// A delivery's headers, by their lowercase names, as its row keeps them
function keptHeaders(headers: Headers) {
    const kept: Record<string, string> = {}
    for (const [name, value] of headers) {
        if (!UNKEPT_HEADERS.has(name)) {
            kept[name] = value
        }
    }
    return kept
}
