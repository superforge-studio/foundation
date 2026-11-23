import { eq } from "drizzle-orm"
import { expect, test } from "vitest"
import { rate_limits } from "@/database/schema"
import { testDatabase } from "@/database/tests/support/database"
import { DAY, HOUR } from "@/utilities/primitives/durations"
import { countAttempt, networkKey } from "../count"

// The limiter any route anyone may call counts its attempts with: up to
// `most` in a window, each `bucket` and `key` on its own, a new window once
// the last has ended, and the network counted by a hash

test("attempts count up to the most a window allows, then wait for it to end", async () => {
    const database = await testDatabase()
    const limited = { bucket: "forms", key: networkKey("203.0.113.9"), most: 2 }

    expect(await countAttempt(database, limited)).toEqual({
        ok: true,
        data: { count: 1 }
    })
    expect(await countAttempt(database, limited)).toEqual({
        ok: true,
        data: { count: 2 }
    })
    const refused = await countAttempt(database, limited)
    expect(refused.ok).toBe(false)
    if (!refused.ok) {
        expect(refused.error.retry_after).toBeGreaterThan(HOUR / 1000 - 60)
        expect(refused.error.retry_after).toBeLessThanOrEqual(HOUR / 1000)
    }

    // Another network, and another thing limited, count on their own
    expect(
        await countAttempt(database, {
            ...limited,
            key: networkKey("198.51.100.7")
        })
    ).toEqual({ ok: true, data: { count: 1 } })
    expect(
        await countAttempt(database, { ...limited, bucket: "bookings" })
    ).toEqual({ ok: true, data: { count: 1 } })
})

test("a window that has ended starts again, and one ended a day ago is deleted", async () => {
    const database = await testDatabase()
    const key = networkKey("203.0.113.9")
    await database.insert(rate_limits).values([
        {
            bucket: "forms",
            key,
            window_started_at: new Date(Date.now() - 2 * HOUR),
            count: 10
        },
        {
            bucket: "forms",
            key: networkKey("198.51.100.7"),
            window_started_at: new Date(Date.now() - 2 * DAY),
            count: 3
        }
    ])

    expect(
        await countAttempt(database, { bucket: "forms", key, most: 10 })
    ).toEqual({ ok: true, data: { count: 1 } })
    const left = await database
        .select({ key: rate_limits.key })
        .from(rate_limits)
        .where(eq(rate_limits.bucket, "forms"))
    expect(left).toEqual([{ key }])
})

test("a network is counted by a hash of it, an IPv6 address by its /64", () => {
    expect(networkKey("2001:db8:85a3:12::1")).toBe(
        networkKey("2001:db8:85a3:12:abcd::9")
    )
    expect(networkKey("2001:db8:85a3:12::1")).not.toBe(
        networkKey("2001:db8:85a3:13::1")
    )
    expect(networkKey("203.0.113.9")).not.toContain("203")
    expect(networkKey("203.0.113.9")).toMatch(/^[0-9a-f]{64}$/)
})
