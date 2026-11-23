import { eq, sql } from "drizzle-orm"
import type { Database } from "@/database"
import { users } from "@/database/schema"
import { now } from "@/database/time"
import { queueEvent } from "../workflows/queue"
import {
    type Access,
    listedInternal,
    listedRole,
    nameOf,
    roleFor
} from "./access"
import {
    SESSION_USER_COLUMNS,
    type SessionUser,
    startSession
} from "./sessions"

/**
 * Whether `email` may start signing in, before Infra is asked to email it:
 * anyone may when anyone can sign in, and otherwise only someone listed as
 * internal (access.ts), or already on the People screen.
 */
export async function maySignIn(
    database: Database,
    access: Access,
    email: string
) {
    if (
        access.sign_in === "anyone" ||
        listedInternal(access, email) !== undefined
    ) {
        return true
    } else {
        const [found] = await database
            .select({ id: users.id })
            .from(users)
            .where(eq(users.email, email))
        return found !== undefined
    }
}

/**
 * Signs in the user with this email, once Infra has said it's theirs: makes
 * the user the first time the address signs in, when anyone may, marks
 * them signed in now, and starts a session in place of this browser's
 * (`replacing`), all together. Their role and, for the business's own, their
 * name are set as access.ts lists them every time, so the database follows
 * the list: someone listed is internal with the name they're listed with,
 * and someone taken off it is external again. A sign-in that makes
 * someone new queues `user-signed-up` in the same transaction, named for
 * them, so whatever's on it (the notice to the team) runs once, and only
 * if they're made. Answers the user, the new session's token, for its
 * cookie, and whether this sign-in made them. Refuses someone nobody
 * listed or added when only they may sign in.
 */
export async function signIn(
    database: Database,
    {
        email,
        replacing,
        user_agent,
        access
    }: {
        email: string
        replacing: string | undefined
        user_agent: string | null
        access: Access
    }
): AsyncOperation<
    { user: SessionUser; token: string; joined: boolean },
    "not-listed"
> {
    return await database.transaction(async (transaction) => {
        const listed = listedInternal(access, email)
        let signed_in: SessionUser
        let joined: boolean
        if (listed === undefined) {
            const [existing] = await transaction
                .select({ role: users.role })
                .from(users)
                .where(eq(users.email, email))
            if (existing === undefined && access.sign_in === "listed") {
                return { ok: false, error: "not-listed" }
            }
            const role =
                existing === undefined
                    ? "external"
                    : roleFor(access, email, existing.role)
            const [user] = await transaction
                .insert(users)
                .values({ email, role, signed_in_at: now })
                .onConflictDoUpdate({
                    target: users.email,
                    set: { role, signed_in_at: now }
                })
                .returning({
                    ...SESSION_USER_COLUMNS,
                    // Whether the insert made the row, rather than updating
                    // it (a comparison, so a boolean)
                    joined: sql<boolean>`xmax = 0`
                })
            if (user === undefined) {
                // An insert that updates on conflict always answers its row
                throw new Error("A user's upsert answered no row")
            }
            const { joined: made, ...rest } = user
            signed_in = rest
            joined = made
        } else {
            const values = {
                email,
                name: nameOf(listed),
                role: listedRole(listed),
                signed_in_at: now
            }
            const [user] = await transaction
                .insert(users)
                .values(values)
                .onConflictDoUpdate({
                    target: users.email,
                    set: {
                        name: values.name,
                        role: values.role,
                        signed_in_at: now
                    }
                })
                .returning(SESSION_USER_COLUMNS)
            if (user === undefined) {
                throw new Error("A user's upsert answered no row")
            }
            signed_in = user
            // One of the business's own is never a sign-up, even the first
            // time: no notice goes out about them
            joined = false
        }

        const token = await startSession(
            transaction,
            signed_in.id,
            replacing,
            user_agent
        )
        if (joined) {
            await queueEvent(
                transaction,
                "user-signed-up",
                { user_id: signed_in.id, email: signed_in.email },
                { id: signed_in.id }
            )
        }
        return { ok: true, data: { user: signed_in, token, joined } }
    })
}
