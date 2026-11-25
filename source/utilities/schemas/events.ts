import { z } from "zod"

// An event's fields: what the pages send the app's own /api/visits
// (frontend/visitors/) and what the server records itself, each checked
// here before it's kept (backend/visits/, whose README has the rules).

/** How many events one batch from a page carries at most. */
export const EVENTS_A_CALL = 100

/**
 * How big one batch's body can be, in bytes: what a page can send as it
 * closes (`fetch` with `keepalive` takes 64 KB at most, for all a page's
 * calls in flight).
 */
export const EVENTS_BODY_LIMIT = 64 * 1024

/**
 * An event's name: lowercase words joined by hyphens, at most 64
 * characters, like `view` or `booked-a-call`.
 */
export const event_name = z
    .string()
    .max(64)
    .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)

/**
 * The rest of an event, flat: at most 32, each named in at most 64
 * characters, and a string of at most 1,000 characters, a number, a
 * boolean or null.
 */
export const event_properties = z
    .record(
        z.string().min(1).max(64),
        z.union([z.string().max(1000), z.number(), z.boolean(), z.null()])
    )
    .refine((properties) => Object.keys(properties).length <= 32, {
        message: "More than 32 properties"
    })
export type EventProperties = z.infer<typeof event_properties>

/**
 * A visitor's lasting ID, which the app's `visitor` cookie holds: 8 to 64
 * letters, digits, `_` or `-`, like a UUID.
 */
export const browser_id = z.string().regex(/^[\w-]{8,64}$/)

/** A page's path, starting `/`, without its query or fragment. */
export const page_path = z
    .string()
    .max(2048)
    .regex(/^\/[^?#]*$/)
