import { createHmac, timingSafeEqual } from "node:crypto"
import { MINUTE } from "@/utilities/primitives/durations"
import type { Delivery, Refusal } from "./sources"

// Checking a webhook signed as Standard Webhooks says
// (https://www.standardwebhooks.com), which Resend's webhooks are, through
// Svix, and Infra's will be: the sender signs `<id>.<timestamp>.<body>`
// with HMAC-SHA256 and a secret both sides hold, and sends the id, the
// timestamp and the signatures as headers, `webhook-*`, or `svix-*` from
// Svix.

/** The fewest bytes a signing secret's key may be (Standard Webhooks says 24 to 64). */
export const SHORTEST_KEY = 24

/** How far a delivery's timestamp may be from now, either way. */
export const STANDARD_TOLERANCE = 5 * MINUTE

/**
 * Whether `delivery` was signed with `secret` (`whsec_` and its key in
 * base64), within `STANDARD_TOLERANCE` of `now`, over its body's bytes as
 * they came. Any one of its signatures may match, since a sender rotating
 * its secret sends one for each. Compared in constant time. A secret whose
 * key is shorter than `SHORTEST_KEY` bytes, like `whsec_` alone or text
 * that isn't base64, is `unconfigured`: anyone could sign with it.
 */
export function verifyStandardWebhook(
    delivery: Pick<Delivery, "headers" | "bytes">,
    secret: string,
    now = Date.now()
): OperationResult<null, Refusal> {
    const id = header(delivery.headers, "id")
    const timestamp = header(delivery.headers, "timestamp")
    const signatures = header(delivery.headers, "signature")
    if (id === null || timestamp === null || signatures === null) {
        return refused(
            "It has no webhook-id, webhook-timestamp or webhook-signature"
        )
    }

    const seconds = Number(timestamp)
    if (!Number.isInteger(seconds)) {
        return refused("Its timestamp isn't a number of seconds")
    } else if (Math.abs(now - seconds * 1000) > STANDARD_TOLERANCE) {
        return refused("Its timestamp is too far from now")
    }

    const key = Buffer.from(
        secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret,
        "base64"
    )
    if (key.length < SHORTEST_KEY) {
        return {
            ok: false,
            error: {
                reason: "unconfigured",
                problem: `The signing secret's key is ${key.length} bytes, fewer than ${SHORTEST_KEY}: set it to the secret the sender gives, whsec_ and its key in base64`
            }
        }
    }
    const expected = createHmac("sha256", key)
        .update(`${id}.${timestamp}.`)
        .update(delivery.bytes)
        .digest()
    const matched = signatures.split(" ").some((signature) => {
        const [version, value] = signature.split(",")
        if (version !== "v1" || value === undefined) {
            return false
        } else {
            const given = Buffer.from(value, "base64")
            return (
                given.length === expected.length &&
                timingSafeEqual(given, expected)
            )
        }
    })
    if (matched) {
        return { ok: true, data: null }
    } else {
        return refused("None of its signatures matched")
    }
}

// A header by its Standard Webhooks name, or Svix's
function header(headers: Headers, name: string) {
    return headers.get(`webhook-${name}`) ?? headers.get(`svix-${name}`)
}

function refused(problem: string): OperationResult<null, Refusal> {
    return { ok: false, error: { reason: "bad-signature", problem } }
}
