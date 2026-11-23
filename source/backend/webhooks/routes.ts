import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { z } from "zod"
import type { ApiEnvironment } from "../context"
import { failure, validated } from "../failures"
import { logMiss } from "../misses/log"
import { takeDelivery } from "./deliveries"

// The largest webhook kept: HighLevel's run to about a megabyte, and most
// are a few kilobytes
const DELIVERY_BODY_LIMIT = 2 * 1024 * 1024

// A source's name in a path: lowercase words and hyphens
const source_path = z.object({
    source: z
        .string()
        .max(60)
        .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
})

/**
 * Webhooks other services post, at /api/webhooks/<source>, from the
 * sources in `context.var.webhook_sources` (sources.ts, README.md). No one
 * logs in for one: its signature says who sent it. It's mounted ahead of
 * the API's check for another site's forms (index.ts), since some senders,
 * like Twilio, post forms, and none sends an Origin.
 *
 * Each delivery is kept as it came, checked, and its events queued for the
 * workflows on them, before it's answered: 200 once it's taken, whether it
 * queued anything or not, 401 `bad-signature` when it isn't its source's,
 * 503 `unconfigured` when the source's secret isn't set, which a sender
 * retries, and 400 `unreadable` for a body that isn't what the source
 * sends. A source that isn't listed is 404 `not-found`, logged as a miss,
 * and keeps nothing.
 */
export const webhookRoutes = new Hono<ApiEnvironment>().post(
    "/webhooks/:source",
    validated("param", source_path),
    bodyLimit({
        maxSize: DELIVERY_BODY_LIMIT,
        onError: (context) =>
            failure(context, 413, "too-large", "A webhook is at most 2 MB")
    }),
    async (context) => {
        const { source: name } = context.req.valid("param")
        const source = context.var.webhook_sources.find(
            (each) => each.name === name
        )
        if (source === undefined) {
            // A sender given an address that isn't one: a miss, logged as
            // the API's own are (misses/log.ts), since a webhook's
            // signature header marks it meant for the app
            logMiss(context.req.raw, 404)
            return failure(
                context,
                404,
                "not-found",
                "No webhook source by that name"
            )
        }

        const taken = await takeDelivery(context.var.database, source, {
            headers: context.req.raw.headers,
            body: await context.req.text(),
            received_at: new Date()
        })
        if (taken.ok) {
            console.info("A webhook was taken", {
                source: name,
                outcome: taken.data.outcome
            })
            return context.json({ received: true as const }, 200)
        }

        const { reason, problem } = taken.error
        console.warn("A webhook was turned away", {
            source: name,
            reason,
            problem
        })
        if (reason === "bad-signature") {
            return failure(context, 401, reason, problem)
        } else if (reason === "unconfigured") {
            return failure(context, 503, reason, problem)
        } else {
            return failure(context, 400, reason, problem)
        }
    }
)
