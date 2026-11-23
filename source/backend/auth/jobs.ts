import { z } from "zod"
import { defineJob } from "@/backend/jobs/define"
import { countExpiredSessions, deleteExpiredSessions } from "./sessions"

// How many sessions each step deletes
const BATCH = 500

// What a step answered, as DBOS keeps it and hands it back to a run that
// starts again: checked as it's read (workbench/writing-code.md, "Zod
// where data comes in")
const deleted_count = z.number().int()

/**
 * Deletes the sessions that have run out, which no browser can log in
 * with any more, a batch at a time: the template's example of a job, which
 * someone on the team, or Claude through the MCP, starts after its dry run.
 * A new session already clears its own user's (sessions.ts), so these are
 * the ones of people who never came back.
 */
export const pruneSessions = defineJob({
    name: "prune-sessions",
    description:
        "Deletes the sessions that have run out, which no browser can log in with any more, 500 at a time. Takes nothing: {}.",
    input: z.object({}),
    plan: async (database) => {
        const expired = await countExpiredSessions(database)
        return {
            summary: `${expired} sessions have run out and would be deleted.`,
            changes: expired
        }
    },
    title: () => "Delete the sessions that have run out",
    run: async (_input, context) => {
        let deleted = 0
        let batch = 0
        let last = BATCH
        while (last === BATCH) {
            last = deleted_count.parse(
                await context.step(`delete-batch-${batch}`, () =>
                    deleteExpiredSessions(context.database, BATCH)
                )
            )
            deleted += last
            batch += 1
        }
        console.info("Sessions that had run out deleted", { deleted })
        return { deleted }
    }
})
