import { expect, test } from "vitest"
import { verifyStandardWebhook } from "../standard"
import { SECRET, signedHeaders } from "./support/sign"

// Standard Webhooks' signatures, against the example its spec and Svix's
// docs give, and the ways a delivery fails one

test("the spec's own example checks out", () => {
    const delivery = {
        headers: new Headers({
            "webhook-id": "msg_p5jXN8AQM9LWM0D4loKWxJek",
            "webhook-timestamp": "1614265330",
            "webhook-signature":
                "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE="
        }),
        bytes: Buffer.from('{"test": 2432232314}')
    }
    expect(
        verifyStandardWebhook(
            delivery,
            "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw",
            1614265330 * 1000
        )
    ).toEqual({ ok: true, data: null })
})

test("Svix's headers, and any one of several signatures, check out", () => {
    const body = '{"type":"email.sent"}'
    const signed = signedHeaders(body)
    const delivery = {
        headers: new Headers({
            "svix-id": signed["webhook-id"],
            "svix-timestamp": signed["webhook-timestamp"],
            // A rotated secret's, then the current one's
            "svix-signature": `v1,${Buffer.alloc(32).toString("base64")} ${signed["webhook-signature"]}`
        }),
        bytes: Buffer.from(body)
    }
    expect(verifyStandardWebhook(delivery, SECRET).ok).toBe(true)
})

test("a changed body, an old timestamp, another secret or no signature is refused", () => {
    const body = '{"type":"email.sent"}'
    const refusal = (headers: Record<string, string>, payload = body) => {
        const checked = verifyStandardWebhook(
            { headers: new Headers(headers), bytes: Buffer.from(payload) },
            SECRET
        )
        return checked.ok ? null : checked.error
    }

    expect(refusal(signedHeaders(body), '{"type":"email.bounced"}')).toEqual({
        reason: "bad-signature",
        problem: "None of its signatures matched"
    })
    expect(
        refusal(
            signedHeaders(body, {
                timestamp: Math.floor(Date.now() / 1000) - 10 * 60
            })
        )?.problem
    ).toBe("Its timestamp is too far from now")
    expect(
        refusal(
            signedHeaders(body, {
                secret: `whsec_${Buffer.from("another secret, 24 bytes or more").toString("base64")}`
            })
        )?.problem
    ).toBe("None of its signatures matched")
    expect(refusal({})?.problem).toBe(
        "It has no webhook-id, webhook-timestamp or webhook-signature"
    )
})

test("a secret too short to be a key is unconfigured, not something anyone can sign with", () => {
    const body = '{"type":"email.sent"}'
    for (const secret of [
        "whsec_",
        "whsec_not base64!",
        `whsec_${Buffer.from("short").toString("base64")}`
    ]) {
        const checked = verifyStandardWebhook(
            {
                headers: new Headers(signedHeaders(body, { secret })),
                bytes: Buffer.from(body)
            },
            secret
        )
        expect(checked.ok ? null : checked.error.reason).toBe("unconfigured")
    }
})

test("the signature is over the body's bytes as they came, a byte-order mark and all", () => {
    const bytes = Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from('{"type":"email.sent"}')
    ])
    const checked = verifyStandardWebhook(
        { headers: new Headers(signedHeaders(bytes)), bytes },
        SECRET
    )
    expect(checked.ok).toBe(true)
})
