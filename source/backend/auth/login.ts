import { eq } from "drizzle-orm"
import type { Database } from "@/database"
import { users } from "@/database/schema"
import { now } from "@/database/time"
import type { Infra } from "../infra"
import { clearConnections, comingBack, keepListed } from "../users/sync"
import { type Access, listedInternal, listing } from "./access"
import { startSession, TEAM_ROW_COLUMNS, type TeamMember } from "./sessions"

/**
 * Whether `email` may start logging in, before Infra is asked to email it:
 * only someone on the team, as access.ts lists them.
 */
export function mayLogIn(access: Access, email: string) {
    return listedInternal(access, email) !== undefined
}

/**
 * Logs in the team member with this email, once Infra has said it's
 * theirs: makes their row follow the list (users/sync.ts), making it if the
 * server hasn't since they were listed, marks them logged in now, and
 * starts a session in place of this browser's (`replacing`), all together.
 * A row that has to come back first, deactivated or with another address,
 * has Infra end Claude's connections as it, and `unavailable` is the answer
 * when Infra doesn't. Answers them, with the names and role the list gives
 * them, and the new session's token, for its cookie. Refuses anyone the
 * list doesn't have.
 */
export async function logIn(
    database: Database,
    {
        email,
        replacing,
        user_agent,
        access,
        infra
    }: {
        email: string
        replacing: string | undefined
        user_agent: string | null
        access: Access
        infra: Infra
    }
): AsyncOperationResult<
    { user: TeamMember; token: string },
    "not-listed" | "unavailable"
> {
    const listed = listedInternal(access, email)
    if (listed === undefined) {
        return { ok: false, error: "not-listed" }
    } else {
        const cleared = await clearConnections(
            infra,
            await comingBack(database, [listed])
        )
        return await database.transaction(async (transaction) => {
            const kept = await keepListed(transaction, listed, cleared)
            if (!kept.ok) {
                return { ok: false, error: "unavailable" }
            }
            const { id } = kept.data
            const [row] = await transaction
                .update(users)
                .set({ logged_in_at: now })
                .where(eq(users.id, id))
                .returning(TEAM_ROW_COLUMNS)
            if (row === undefined) {
                throw new Error("A team member's row went missing")
            }
            const token = await startSession(
                transaction,
                id,
                replacing,
                user_agent
            )
            const user: TeamMember = { ...row, ...listing(listed) }
            return { ok: true, data: { user, token } }
        })
    }
}
