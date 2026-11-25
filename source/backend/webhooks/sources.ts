import type { z } from "zod"
import type { EventData, EventName } from "../workflows/events"
import { verifyStandardWebhook } from "./standard"

// The services that post the app webhooks, each at /api/webhooks/<name>
// (README.md): how a delivery is checked to be theirs, and the events it
// queues once it is, which the workflows on them take from there. The
// template has none of its own; this app's are listed in ./app.ts
// (`APP_SOURCES`). A source
// reads only what its delivery says, and never writes: the workflows do
// the work, with their retries.

/**
 * A webhook as it came: its headers, its body's bytes exactly, which a
 * signature is checked against, the same read as UTF-8 text, and when.
 */
export type Delivery = {
    headers: Headers
    bytes: Uint8Array
    body: string
    received_at: Date
}

/** Why a delivery was refused, and what was wrong, for whoever reads it. */
export type Refusal = {
    // `bad-signature`: it isn't the source's, or was changed on the way;
    // `unconfigured`: the source's secret isn't set, so nothing can be
    reason: "bad-signature" | "unconfigured"
    problem: string
}

/**
 * An event a delivery queues (workflows/events.ts), with an `id` that names
 * what happened when the sender's payload has one, like Stripe's event ID,
 * so a retry of it queues each workflow once.
 */
export type WebhookEvent = {
    [Name in EventName]: { name: Name; data: EventData<Name>; id?: string }
}[EventName]

/** A service that posts the app webhooks. */
export type WebhookSource = {
    // Where it posts, /api/webhooks/<name>: lowercase words and hyphens
    name: string
    // Whether a delivery is the source's, by its signature
    verify: (delivery: Delivery) => OperationResult<null, Refusal>
    // The sender's own ID for a delivery, which it sends again with a
    // retry, or null when it has none
    deliveryId: (delivery: Delivery) => string | null
    // The events a delivery that checked out queues: none for one that says
    // nothing the app acts on, and a problem for a body that isn't what the
    // source sends
    events: (delivery: Delivery) => OperationResult<WebhookEvent[], string>
}

/**
 * A source that signs its webhooks as Standard Webhooks says
 * (standard.ts), as Resend does, and Infra will: checked with the secret
 * `secret` reads, from a Railway variable, and identified by its
 * `webhook-id`. Its `events` reads the body.
 */
export function standardWebhooksSource(definition: {
    name: string
    // The signing secret (`whsec_…`), or undefined when it isn't set
    secret: () => string | undefined
    events: WebhookSource["events"]
}): WebhookSource {
    return {
        name: definition.name,
        verify: (delivery) => {
            const secret = definition.secret()
            if (secret === undefined || secret === "") {
                return {
                    ok: false,
                    error: {
                        reason: "unconfigured",
                        problem: `The ${definition.name} source's signing secret isn't set`
                    }
                }
            } else {
                return verifyStandardWebhook(delivery, secret)
            }
        },
        deliveryId: (delivery) =>
            delivery.headers.get("webhook-id") ??
            delivery.headers.get("svix-id"),
        events: definition.events
    }
}

/**
 * A delivery's body as JSON, checked against `schema`, for a source's
 * `events`: a problem, saying what didn't fit, when it isn't.
 */
export function readJson<Schema extends z.ZodType>(
    delivery: Delivery,
    schema: Schema
): OperationResult<z.output<Schema>, string> {
    let parsed: unknown
    try {
        parsed = JSON.parse(delivery.body)
    } catch {
        return { ok: false, error: "The body isn't JSON" }
    }
    const fitted = schema.safeParse(parsed)
    if (fitted.success) {
        return { ok: true, data: fitted.data }
    } else {
        return {
            ok: false,
            error: `The body isn't what the source sends: ${fitted.error.message}`
        }
    }
}
