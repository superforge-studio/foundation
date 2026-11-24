import { z } from "zod"
import { defineWorkflow, scheduled_input } from "../workflows/define"
import { emptyExpired } from "./trash"

// What its step answered, as DBOS keeps it and hands it back to a run that
// starts again: checked as it's read
const emptied = z.object({ deleted: z.number() })

/**
 * Each hour, at a quarter past, deletes for good what's been in Trash 30
 * days, and the uploads never finished in a day (trash.ts's
 * `emptyExpired`), on a schedule rather than when someone looks, so it
 * holds whether anyone does, and a `GET` never deletes anything. Quiet,
 * since it's worth reading only when it fails.
 */
export const emptyTrash = defineWorkflow({
    name: "empty-trash",
    input: scheduled_input,
    schedule: "15 * * * *",
    quiet: true,
    title: () => "Empty Trash of what's been there 30 days",
    run: async (_scheduled, context) =>
        emptied.parse(
            await context.step("delete", async () => ({
                deleted: await emptyExpired(context.database, context.storage)
            }))
        )
})
