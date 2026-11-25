import { eq } from "drizzle-orm"
import { expect, test, vi } from "vitest"
import { networkKey } from "@/backend/rate-limits/count"
import { testApi } from "@/backend/tests/support/api"
import { logInAs } from "@/backend/tests/support/login"
import { analytics_events, rate_limits } from "@/database/schema"
import { DAY } from "@/utilities/primitives/durations"
import { api_failure } from "@/utilities/schemas/failures"
import type { PageEvent } from "@/utilities/schemas/visits"
import { batchCost, PAGE_EVENTS_A_DAY } from "../limit"

// How much of the pages' events one network may send in a day: what a
// batch counts as, the network refused past it, and who isn't counted

const IPHONE =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1"

const OFFICE = "203.0.113.9"

const WARNING =
    "A network sent more page events than a day allows, so the rest of its day's are refused"

// A page's event, a moment ago
function event(properties: PageEvent["properties"] = {}): PageEvent {
    return { name: "view", at: Date.now() - 1000, path: "/", properties }
}

// Posts a batch of one event as a page does, from a phone on `ip`, with
// any other `headers`
async function post(
    api: Awaited<ReturnType<typeof testApi>>,
    ip: string,
    headers: Record<string, string> = {}
) {
    return await api.client.api.visits.$post(
        { json: { sent_at: Date.now(), events: [event()] } },
        { headers: { "User-Agent": IPHONE, "X-Real-IP": ip, ...headers } }
    )
}

// What each network has sent of its day
async function counted(api: Awaited<ReturnType<typeof testApi>>) {
    return await api.database
        .select({ key: rate_limits.key, count: rate_limits.count })
        .from(rate_limits)
        .where(eq(rate_limits.bucket, "visits"))
}

test("a batch counts as its events, or its kilobytes when that's more", () => {
    expect(batchCost([event({ title: "Pricing" })])).toBe(1)
    // The most a batch carries, a few dozen bytes each
    expect(batchCost(Array.from({ length: 100 }, () => event()))).toBe(100)
    // One event of about seven and a half kilobytes
    const long = Object.fromEntries(
        Array.from({ length: 7 }, (_, index) => [
            `part_${index}`,
            "x".repeat(1000)
        ])
    )
    expect(batchCost([event({ ...long, rest: "x".repeat(500) })])).toBe(8)
})

test("a network past what a day allows is refused with when to try again, nothing of it is kept, and it's logged once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const api = await testApi()
    await api.database.insert(rate_limits).values({
        bucket: "visits",
        key: networkKey(OFFICE),
        window_started_at: new Date(),
        count: PAGE_EVENTS_A_DAY - 1
    })

    // The last its day allows is kept
    expect((await post(api, OFFICE)).status).toBe(200)

    // Then it's refused, until its day is over
    const refused = await post(api, OFFICE)
    expect(refused.status).toBe(429)
    const retry_after = Number(refused.headers.get("Retry-After"))
    expect(retry_after).toBeGreaterThan(DAY / 1000 - 60)
    expect(retry_after).toBeLessThanOrEqual(DAY / 1000)
    expect(api_failure.parse(await refused.json()).error).toEqual({
        reason: "too-many",
        message: "This network has sent all the page events a day allows",
        retry_after
    })
    expect(await api.database.select().from(analytics_events)).toHaveLength(1)

    // Logged as it went past, not again with each batch after
    expect((await post(api, OFFICE)).status).toBe(429)
    expect(warn.mock.calls.filter(([message]) => message === WARNING)).toEqual([
        [WARNING, { retry_after: expect.any(Number) }]
    ])

    // Another network counts on its own
    expect((await post(api, "198.51.100.7")).status).toBe(200)
})

test("the team's batches, and a bot's, aren't counted, and a visitor's are", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const api = await testApi()
    const ada = await logInAs(api, "ada@example.com")

    expect((await post(api, OFFICE, { cookie: ada.cookie })).status).toBe(200)
    expect(
        (
            await post(api, OFFICE, {
                "User-Agent":
                    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
            })
        ).status
    ).toBe(200)
    expect(await counted(api)).toEqual([])

    expect((await post(api, OFFICE)).status).toBe(200)
    expect(await counted(api)).toEqual([{ key: networkKey(OFFICE), count: 1 }])
})
