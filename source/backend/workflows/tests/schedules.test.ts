import { validateCrontab } from "@dbos-inc/dbos-sdk/internal/scheduler/crontab"
import { expect, test } from "vitest"
import { pruneWebhookDeliveries } from "@/backend/webhooks/workflows"
import { WORKFLOWS } from "../index"

// The workflows on a schedule: each one DBOS can run, checked here, since
// one DBOS refuses as the workflows launch is only logged and left out
// (engine.ts's `applySchedules`), so it would never run, and nothing else
// would say so.

test("every workflow's schedule is one DBOS runs", () => {
    const scheduled = WORKFLOWS.flatMap((workflow) =>
        workflow.schedule === null ? [] : [workflow.schedule]
    )
    expect(scheduled).not.toEqual([])
    for (const schedule of scheduled) {
        expect(() => validateCrontab(schedule)).not.toThrow()
    }
    expect(() => validateCrontab("every hour")).toThrow()
})

test("a scheduled run is named from the moment it fired, as DBOS hands it, or as it was queued", () => {
    const fired = new Date("2026-11-22T10:00:00.000Z")
    expect(pruneWebhookDeliveries.title(fired)).toBe(
        "Delete old webhook deliveries"
    )
    expect(
        pruneWebhookDeliveries.title({ scheduled_at: fired.toISOString() })
    ).toBe("Delete old webhook deliveries")
    expect(pruneWebhookDeliveries.title({ user_id: "nobody" })).toBeNull()
})
