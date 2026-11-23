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
 * Tells the business's own people that someone new has signed up, as the
 * template's example of background work: it's on `user-signed-up`, which
 * the login that makes a user queues in its own transaction
 * (backend/auth/login.ts), under an id named for them, so it runs once. Until Superforge Infra can send email it writes the notice to the
 * logs; then `send-notice` emails it, with an idempotency key of the run's
 * id, so sending twice sends once. Every step is safe to run again
 * (backend/workflows/README.md).
 */
export const tellTeamOfSignUp = defineWorkflow({
    name: "tell-team-of-sign-up",
    input: z.object({ user_id: z.uuid(), email: z.string() }),
    on: ["user-signed-up"],
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
                console.info("Someone new signed up", {
                    email: user.email,
                    name: user.name,
                    telling: team
                })
                return { told: team.length }
            })
        )
    }
})
