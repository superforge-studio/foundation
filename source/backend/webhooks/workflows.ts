import { z } from "zod"
import { defineWorkflow, scheduled_input } from "../workflows/define"
import { pruneDeliveries } from "./prune"

// What its step answered, as DBOS keeps it and hands it back to a run that
// starts again: checked as it's read
const pruned = z.object({ deleted: z.number() })

/**
 * Each hour, on the hour, deletes the deliveries older than they're kept
 * (prune.ts): the template's example of a workflow on a schedule, and a
 * quiet one, since a prune is worth reading only when it fails.
 */
export const pruneWebhookDeliveries = defineWorkflow({
    name: "prune-webhook-deliveries",
    input: scheduled_input,
    schedule: "0 * * * *",
    quiet: true,
    title: () => "Delete old webhook deliveries",
    run: async (_scheduled, context) =>
        pruned.parse(
            await context.step("delete", async () => ({
                deleted: await pruneDeliveries(context.database)
            }))
        )
})
