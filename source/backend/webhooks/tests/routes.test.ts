import { randomUUID } from "node:crypto"
import { beforeEach, expect, test, vi } from "vitest"
import { z } from "zod"
import { testApi } from "@/backend/tests/support/api"
import { webhook_deliveries } from "@/database/schema"
import { api_failure } from "@/utilities/schemas/failures"
import {
    readJson,
    standardWebhooksSource,
    type WebhookSource
} from "../sources"
import { SECRET, signedHeaders } from "./support/sign"

// Webhooks through the whole API, from sources of the test's own: each
// delivery kept as it came, its signature checked, and its events queued
// for the workflows on them (the template's notice to the team is on
// `user-added`), once however often it's sent.

beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
})

// A sender that tells the app of sign-ups elsewhere, signed as Standard
// Webhooks says, and sends other news the app doesn't act on
const sample = standardWebhooksSource({
    name: "sample",
    secret: () => SECRET,
    events: (delivery) => {
        const read = readJson(
            delivery,
            z.discriminatedUnion("type", [
                z.object({
                    type: z.literal("user.signed_up"),
                    user_id: z.uuid(),
                    email: z.string()
                }),
                z.object({ type: z.literal("user.waved") })
            ])
        )
        if (!read.ok) {
            return read
        } else if (read.data.type === "user.signed_up") {
            const { user_id, email } = read.data
            return {
                ok: true,
                data: [{ name: "user-added", data: { user_id, email } }]
            }
        } else {
            return { ok: true, data: [] }
        }
    }
})

// One whose secret isn't set yet
const unset = standardWebhooksSource({
    name: "unset",
    secret: () => undefined,
    events: () => ({ ok: true, data: [] })
})

// One that posts forms, as Twilio does, checked by a shared word
const forms: WebhookSource = {
    name: "forms",
    verify: (delivery) =>
        delivery.headers.get("x-shared-word") === "open sesame"
            ? { ok: true, data: null }
            : {
                  ok: false,
                  error: { reason: "bad-signature", problem: "Wrong word" }
              },
    deliveryId: () => null,
    events: () => ({ ok: true, data: [] })
}

const SOURCES = [sample, unset, forms]

function post(
    api: Awaited<ReturnType<typeof testApi>>,
    source: string,
    body: string,
    headers: Record<string, string>
) {
    return api.api.request(`/api/webhooks/${source}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body
    })
}

test("a delivery that checks out is kept as it came, and queues its events once, however often it's sent", async () => {
    const api = await testApi({ webhook_sources: SOURCES })
    const user_id = randomUUID()
    const body = JSON.stringify({
        type: "user.signed_up",
        user_id,
        email: "ada@example.com"
    })
    const headers = {
        ...signedHeaders(body, { id: "msg_1" }),
        Authorization: "Bearer not-kept"
    }

    // Sent, and sent again, as a sender retries one it didn't hear back on
    for (let time = 0; time < 2; time++) {
        const answered = await post(api, "sample", body, headers)
        expect(answered.status).toBe(200)
        expect(await answered.json()).toEqual({ received: true })
    }

    const rows = await api.database.select().from(webhook_deliveries)
    expect(rows).toHaveLength(2)
    for (const row of rows) {
        expect(row).toMatchObject({
            source: "sample",
            delivery_id: "msg_1",
            body,
            outcome: "accepted",
            problem: null,
            events: [
                {
                    name: "user-added",
                    runs: [`tell-team-of-new-member-sample-msg_1-0`]
                }
            ]
        })
        expect(row.headers).toMatchObject({ "webhook-id": "msg_1" })
        expect(row.headers).not.toHaveProperty("authorization")
    }
    expect(await api.queued()).toEqual([
        {
            workflow: "tell-team-of-new-member",
            id: "tell-team-of-new-member-sample-msg_1-0",
            input: { user_id, email: "ada@example.com" },
            queue: "background"
        }
    ])
})

test("one with a bad signature is kept, refused and queues nothing", async () => {
    const api = await testApi({ webhook_sources: SOURCES })
    const body = JSON.stringify({ type: "user.waved" })
    const answered = await post(
        api,
        "sample",
        body,
        signedHeaders('{"type":"something else"}')
    )
    expect(answered.status).toBe(401)
    expect(api_failure.parse(await answered.json()).error.reason).toBe(
        "bad-signature"
    )

    const [row] = await api.database.select().from(webhook_deliveries)
    expect(row).toMatchObject({
        body,
        outcome: "refused",
        problem: "None of its signatures matched"
    })
    expect(await api.queued()).toEqual([])
})

test("a source whose secret isn't set refuses with 503, which a sender tries again", async () => {
    const api = await testApi({ webhook_sources: SOURCES })
    const answered = await post(api, "unset", "{}", signedHeaders("{}"))
    expect(answered.status).toBe(503)
    expect(api_failure.parse(await answered.json()).error.reason).toBe(
        "unconfigured"
    )
})

test("a body the source doesn't send fails, and one that says nothing the app acts on is ignored", async () => {
    const api = await testApi({ webhook_sources: SOURCES })
    const strange = JSON.stringify({ type: "user.signed_up" })
    const failed = await post(api, "sample", strange, signedHeaders(strange))
    expect(failed.status).toBe(400)
    expect(api_failure.parse(await failed.json()).error.reason).toBe(
        "unreadable"
    )

    const wave = JSON.stringify({ type: "user.waved" })
    const ignored = await post(api, "sample", wave, signedHeaders(wave))
    expect(ignored.status).toBe(200)

    const outcomes = await api.database
        .select({ outcome: webhook_deliveries.outcome })
        .from(webhook_deliveries)
    expect(outcomes.map((row) => row.outcome).sort()).toEqual([
        "failed",
        "ignored"
    ])
    expect(await api.queued()).toEqual([])
})

test("a sender's form isn't refused as another site's, and a source no one listed keeps nothing", async () => {
    const api = await testApi({ webhook_sources: SOURCES })
    const form = await api.api.request("/api/webhooks/forms", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "X-Shared-Word": "open sesame"
        },
        body: "From=%2B15555550123&Body=Hi"
    })
    expect(form.status).toBe(200)

    // Logged as a miss meant for the app, since it's signed like a webhook
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {})
    const unknown = await post(api, "nobody", "{}", signedHeaders("{}"))
    expect(unknown.status).toBe(404)
    expect(warned).toHaveBeenCalledWith(
        "A request missed that looks meant for the app",
        expect.stringContaining("/api/webhooks/nobody")
    )
    expect(
        (await api.database.select().from(webhook_deliveries)).map(
            (row) => row.source
        )
    ).toEqual(["forms"])
})
