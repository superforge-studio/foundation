import { and, eq, inArray, isNotNull, isNull, notInArray } from "drizzle-orm"
import { appDatabase, type Database } from "@/database"
import { api_tokens, sessions, users } from "@/database/schema"
import { now } from "@/database/time"
import {
    ACCESS,
    type Access,
    type InternalUser,
    nameOf,
    problemsWith
} from "../auth/access"
import { appInfra, type Infra } from "../infra"
import { queueEvent } from "../workflows/queue"

/**
 * Makes the team member's row follow how access.ts lists them, and answers
 * it, with whether this made it: found by their slug, or, for a row from
 * before it had one, by their address, which then takes the slug. Their
 * address and name are the list's, and they're active again if they'd been
 * deactivated. A row it makes queues `user-added`, named for them, in the
 * same transaction, so whatever's on it (the notice to the rest of the
 * team) runs once. Run inside a transaction: the server's start runs it for
 * everyone (`syncInternalUsers`) and each login for the one logging in
 * (auth/login.ts).
 */
export async function keepListed(database: Database, listed: InternalUser) {
    const email = listed.email.trim().toLowerCase()
    const values = {
        slug: listed.slug,
        email,
        name: nameOf(listed),
        deactivated_at: null
    }
    const [by_slug] = await database
        .select({ id: users.id })
        .from(users)
        .where(eq(users.slug, listed.slug))
    const [by_email] =
        by_slug === undefined
            ? await database
                  .select({ id: users.id })
                  .from(users)
                  .where(eq(users.email, email))
            : []
    const found = by_slug ?? by_email

    if (found === undefined) {
        const [inserted] = await database
            .insert(users)
            .values(values)
            .returning({ id: users.id })
        if (inserted === undefined) {
            throw new Error("A user's insert answered no row")
        }
        await queueEvent(
            database,
            "user-added",
            { user_id: inserted.id, email },
            { id: inserted.id }
        )
        return { id: inserted.id, made: true }
    } else {
        await database.update(users).set(values).where(eq(users.id, found.id))
        return { id: found.id, made: false }
    }
}

/**
 * Makes `users` follow the people access.ts lists, all together: each one
 * is a user, with the slug, address and name they're listed with, made now
 * if they've never logged in, so the admin's Settings and the notices to the
 * team have them from the deploy that lists them; and anyone it doesn't
 * list is deactivated, with their sessions ended and their API tokens
 * revoked. Answers how many are
 * listed, how many it made, and how many it deactivated. Refuses a list
 * with a mistake in it (`problemsWith`), changing nothing.
 *
 * The login middleware counts a team member's session only while the
 * list has them (auth/logged-in.ts), so this is what keeps the database
 * telling the same story, not what keeps anyone out.
 */
export async function syncInternalUsers(database: Database, access: Access) {
    const problems = problemsWith(access)
    if (problems.length > 0) {
        throw new Error(`access.ts's list has mistakes: ${problems.join("; ")}`)
    }
    return await database.transaction(async (transaction) => {
        const kept: string[] = []
        let made = 0
        for (const listed of access.internal_users) {
            const user = await keepListed(transaction, listed)
            kept.push(user.id)
            if (user.made) {
                made += 1
            }
        }
        const deactivated = await transaction
            .update(users)
            .set({ deactivated_at: now })
            .where(
                and(
                    isNull(users.deactivated_at),
                    kept.length === 0 ? undefined : notInArray(users.id, kept)
                )
            )
            .returning({ id: users.id })
        // Every deactivated person's, including those from before, which a
        // session started meanwhile can't outlive
        const gone = await transaction
            .select({ id: users.id })
            .from(users)
            .where(isNotNull(users.deactivated_at))
        // Their sessions end, and their API tokens are revoked for good, so
        // none works again if they're listed again
        if (gone.length > 0) {
            const gone_ids = gone.map((user) => user.id)
            await transaction
                .delete(sessions)
                .where(inArray(sessions.user_id, gone_ids))
            await transaction
                .delete(api_tokens)
                .where(inArray(api_tokens.user_id, gone_ids))
        }
        return {
            listed: access.internal_users.length,
            made,
            deactivated: deactivated.length
        }
    })
}

/**
 * `syncInternalUsers` on the server's database with this app's ACCESS, as
 * the server starts (source/node.ts, and a dev server as it first loads
 * source/server.ts). It never rejects: a failure is logged, and the server
 * goes on, since the login middleware counts only the list's people
 * regardless.
 */
export async function syncAppInternalUsers() {
    const database = appDatabase()
    try {
        const synced = await syncInternalUsers(database, ACCESS)
        console.info("The team follows access.ts", synced)
    } catch (error) {
        console.error("The team didn't sync with access.ts", { error })
        return
    }
    try {
        await endConnectionsOfGone(database, appInfra())
    } catch (error) {
        console.error("Claude's connections weren't ended", { error })
    }
}

/**
 * Ends, through Infra, every connection Claude has as someone deactivated,
 * so Claude can't refresh its token, and what it holds runs out within
 * minutes: Claude's tokens are Infra's, signed rather than kept here, so
 * this is the only way to end them. Asked for everyone deactivated, each
 * time the server starts, so a start when Infra didn't answer is made up
 * for by the next; an Infra that doesn't answer is logged once, and asked
 * nothing more. Answers how many connections it ended.
 */
export async function endConnectionsOfGone(database: Database, infra: Infra) {
    const gone = await database
        .select({ id: users.id })
        .from(users)
        .where(isNotNull(users.deactivated_at))
    let ended = 0
    for (const [index, { id }] of gone.entries()) {
        const result = await infra.endAgentConnections(id)
        if (result.ok) {
            ended += result.data
        } else {
            console.warn("Claude's connections weren't ended", {
                left: gone.length - index,
                cause: result.error
            })
            break
        }
    }
    return ended
}
