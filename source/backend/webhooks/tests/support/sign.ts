import { createHmac } from "node:crypto"

/** A Standard Webhooks signing secret, for a test's source. */
export const SECRET = `whsec_${Buffer.from("a test's signing secret").toString("base64")}`

/**
 * The headers a Standard Webhooks sender sends with `body`: its id, the
 * time in seconds, and its signature with `secret`.
 */
export function signedHeaders(
    body: string,
    {
        id = "msg_test",
        secret = SECRET,
        timestamp = Math.floor(Date.now() / 1000)
    }: { id?: string; secret?: string; timestamp?: number } = {}
) {
    const key = Buffer.from(secret.slice("whsec_".length), "base64")
    const signature = createHmac("sha256", key)
        .update(`${id}.${timestamp}.${body}`)
        .digest("base64")
    return {
        "webhook-id": id,
        "webhook-timestamp": String(timestamp),
        "webhook-signature": `v1,${signature}`
    }
}
