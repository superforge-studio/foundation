import { z } from "zod"
import { defineWorkflow } from "@/backend/workflows/define"
import { findUser, internalEmails } from "./find"

// What each step answered, as DBOS keeps it and hands it back to a run
// that starts again, perhaps on newer code: checked as it's read
// (workbench/writing-code.md, "Zod where data comes in")
const found_user = z
    .object({ email: z.string(), name: z.string().nullable() })
    .nullable()
const found_team = z.array(z.string())
const told = z.object({ told: z.number() })

/**
 * Tells the rest of the team that someone new is on it, as the template's
 * example of background work: it's on `user-added`, which the sync that
 * makes their row queues in its own transaction (sync.ts), under an id
 * named for them, so it runs once, from the deploy that lists them. Until
 * Superforge Infra can send email it writes the notice to the logs; then
 * `send-notice` emails it, with an idempotency key of the run's id, so
 * sending twice sends once. Every step is safe to run again
 * (backend/workflows/README.md).
 */
export const tellTeamOfNewMember = defineWorkflow({
    name: "tell-team-of-new-member",
    input: z.object({ user_id: z.uuid(), email: z.string() }),
    on: ["user-added"],
    title: ({ email }) => `Tell the team about ${email}`,
    run: async ({ user_id }, context) => {
        const user = found_user.parse(
            await context.step("read-user", () =>
                findUser(context.database, user_id)
            )
        )
        if (user === null) {
            // Removed before the notice went out: there's no one to tell of
            return { told: 0 }
        }

        const team = found_team.parse(
            await context.step("find-team", () =>
                internalEmails(context.database, user_id)
            )
        )

        return told.parse(
            await context.step("send-notice", async () => {
                console.info("Someone new is on the team", {
                    email: user.email,
                    name: user.name,
                    telling: team
                })
                return { told: team.length }
            })
        )
    }
})
