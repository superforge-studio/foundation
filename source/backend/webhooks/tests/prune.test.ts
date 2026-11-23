import { expect, test } from "vitest"
import { webhook_deliveries } from "@/database/schema"
import { testDatabase } from "@/database/tests/support/database"
import { DAY } from "@/utilities/primitives/durations"
import { KEEP_DELIVERIES_FOR, pruneDeliveries } from "../prune"

test("deliveries older than they're kept are deleted, and the rest stay", async () => {
    const database = await testDatabase()
    const kept = { source: "sample", headers: {}, body: "{}" }
    await database.insert(webhook_deliveries).values([
        { ...kept, body: "old", received_at: new Date(Date.now() - 31 * DAY) },
        { ...kept, body: "new", received_at: new Date(Date.now() - DAY) }
    ])

    expect(KEEP_DELIVERIES_FOR).toBe(30 * DAY)
    expect(await pruneDeliveries(database)).toBe(1)
    expect(await pruneDeliveries(database, "forever")).toBe(0)
    expect(
        (
            await database
                .select({ body: webhook_deliveries.body })
                .from(webhook_deliveries)
        ).map((row) => row.body)
    ).toEqual(["new"])
})
