import { and, eq, inArray, isNotNull, isNull, ne, type SQL } from "drizzle-orm"
import { appDatabase, type Database } from "@/database"
import { api_tokens, sessions, users } from "@/database/schema"
import { now } from "@/database/time"
import {
    ACCESS,
    type Access,
    addressOf,
    type InternalUser,
    listedAs,
    nameOf,
    problemsWith
} from "../auth/access"
import { appInfra, type Infra } from "../infra"
import { queueEvent } from "../workflows/queue"

// The team's rows, following how access.ts lists them. A row is one
// person's slug and the address they log in with, together: a row the list
// no longer has as it is, taken off it or listed with another address, is
// set aside (deactivated), and every way in it had ends, since what was
// let in through the old address may have been someone else's. A set-aside
// row whose slug is listed comes back, under the address listed, once
// Infra has ended Claude's connections as it, which the app can't end
// itself. An address is one active row's, so whoever had it is set aside
// before anyone listed takes it.

/**
 * Makes the team member's row follow how access.ts lists them, found by
 * their slug alone, and answers it, with whether this made it and whether
 * it came back. Their address and name are the list's. A row that has to
 * come back, deactivated or with another address, does only when it's in
 * `cleared`, the rows Infra has said Claude has no connection as
 * (`clearConnections`), with its sessions and API tokens ended; otherwise
 * it stays set aside, and this answers `not-cleared`. Anyone else active
 * with the address is set aside first. A row it makes queues `user-added`,
 * named for them, in the same transaction, so whatever's on it (the notice
 * to the rest of the team) runs once. Run inside a transaction: the
 * server's start runs it for everyone (`syncInternalUsers`) and each login
 * for the one logging in (auth/login.ts).
 */
export async function keepListed(
    database: Database,
    listed: InternalUser,
    cleared: ReadonlySet<string>
): AsyncOperationResult<
    { id: string; made: boolean; came_back: boolean },
    "not-cleared"
> {
    const email = addressOf(listed)
    const values = {
        slug: listed.slug,
        email,
        name: nameOf(listed),
        deactivated_at: null
    }
    // The list has the address as this person's now
    await setAside(
        database,
        and(eq(users.email, email), ne(users.slug, listed.slug))
    )
    const [found] = await database
        .select({
            id: users.id,
            email: users.email,
            deactivated_at: users.deactivated_at
        })
        .from(users)
        .where(eq(users.slug, listed.slug))

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
        return {
            ok: true,
            data: { id: inserted.id, made: true, came_back: false }
        }
    } else if (found.deactivated_at === null && found.email === email) {
        await database.update(users).set(values).where(eq(users.id, found.id))
        return {
            ok: true,
            data: { id: found.id, made: false, came_back: false }
        }
    } else if (cleared.has(found.id)) {
        await endWaysIn(database, [found.id])
        await database.update(users).set(values).where(eq(users.id, found.id))
        return {
            ok: true,
            data: { id: found.id, made: false, came_back: true }
        }
    } else {
        await setAside(database, eq(users.id, found.id))
        return { ok: false, error: "not-cleared" }
    }
}

/**
 * Makes `users` follow the people access.ts lists, all together: first
 * anyone it doesn't have as they are, off the list or listed with another
 * address, is set aside, with their sessions ended and their API tokens
 * revoked; then each listed person is a user, with the slug, address and
 * name they're listed with (`keepListed`), made now if they've never
 * logged in, so the admin's Settings and the notices to the team have them
 * from the deploy that lists them. Before any of it, Infra is asked to end
 * Claude's connections as each row that comes back (`comingBack`), and a
 * row it didn't end them for waits, set aside, for the next start or its
 * person's login. Answers how many are listed, how many it made, how many
 * it deactivated, and how many wait. Refuses a list with a mistake in it
 * (`problemsWith`), changing nothing.
 *
 * The login middleware counts a team member only while the list has their
 * row as it is (`listedAs`, auth/logged-in.ts), so this is what keeps the
 * database telling the same story, not what keeps anyone out.
 */
export async function syncInternalUsers(
    database: Database,
    infra: Infra,
    access: Access
) {
    const problems = problemsWith(access)
    if (problems.length > 0) {
        throw new Error(`access.ts's list has mistakes: ${problems.join("; ")}`)
    }
    const cleared = await clearConnections(
        infra,
        await comingBack(database, access.internal_users)
    )
    return await database.transaction(async (transaction) => {
        // Everyone the list doesn't have as they are, first, so an address
        // handed from one person to another is free before it's taken
        const active = await transaction
            .select({ id: users.id, slug: users.slug, email: users.email })
            .from(users)
            .where(isNull(users.deactivated_at))
        const set_aside = await setAside(
            transaction,
            inArray(
                users.id,
                active
                    .filter((row) => listedAs(access, row) === undefined)
                    .map((row) => row.id)
            )
        )

        let made = 0
        let waiting = 0
        const came_back: string[] = []
        for (const listed of access.internal_users) {
            const kept = await keepListed(transaction, listed, cleared)
            if (!kept.ok) {
                waiting += 1
            } else if (kept.data.made) {
                made += 1
            } else if (kept.data.came_back) {
                came_back.push(kept.data.id)
            }
        }

        // Every deactivated person's, those from before among them, which
        // a login meanwhile can't outlive
        const gone = await transaction
            .select({ id: users.id })
            .from(users)
            .where(isNotNull(users.deactivated_at))
        await endWaysIn(
            transaction,
            gone.map((user) => user.id)
        )
        return {
            listed: access.internal_users.length,
            made,
            deactivated: set_aside.filter((id) => !came_back.includes(id))
                .length,
            waiting
        }
    })
}

/**
 * The rows of these listed people that have to come back to be theirs,
 * found by their slugs: deactivated, or with another address than the one
 * listed. Each comes back only once Infra has ended Claude's connections as
 * it (`clearConnections`), since a connection names the row, and whoever
 * allowed it may not be the person listed now.
 */
export async function comingBack(
    database: Database,
    listed: readonly InternalUser[]
) {
    const rows = await database
        .select({
            id: users.id,
            slug: users.slug,
            email: users.email,
            deactivated_at: users.deactivated_at
        })
        .from(users)
        .where(
            inArray(
                users.slug,
                listed.map((each) => each.slug)
            )
        )
    return rows
        .filter((row) => {
            const as_listed = listed.find((each) => each.slug === row.slug)
            return (
                as_listed !== undefined &&
                (row.deactivated_at !== null ||
                    row.email !== addressOf(as_listed))
            )
        })
        .map((row) => row.id)
}

/**
 * Ends, through Infra, every connection Claude has as each of these rows,
 * and answers the rows it ended them for. An Infra that doesn't answer is
 * logged once, and asked nothing more: the rows left out wait for the next
 * time.
 */
export async function clearConnections(
    infra: Infra,
    ids: readonly string[]
): Promise<ReadonlySet<string>> {
    const cleared = new Set<string>()
    for (const [index, id] of ids.entries()) {
        const ended = await infra.endAgentConnections(id)
        if (ended.ok) {
            cleared.add(id)
        } else {
            console.warn("Claude's connections weren't ended", {
                left: ids.length - index,
                cause: ended.error
            })
            break
        }
    }
    return cleared
}

// Deactivates the active rows `which` picks, ending their sessions and API
// tokens, and answers their ids
async function setAside(database: Database, which: SQL | undefined) {
    const set_aside = await database
        .update(users)
        .set({ deactivated_at: now })
        .where(and(isNull(users.deactivated_at), which))
        .returning({ id: users.id })
    const ids = set_aside.map((row) => row.id)
    await endWaysIn(database, ids)
    return ids
}

// Ends these rows' sessions, and revokes their API tokens for good, so none
// works again, even once the row comes back
async function endWaysIn(database: Database, ids: readonly string[]) {
    if (ids.length > 0) {
        await database.delete(sessions).where(inArray(sessions.user_id, ids))
        await database
            .delete(api_tokens)
            .where(inArray(api_tokens.user_id, ids))
    }
}

/**
 * `syncInternalUsers` on the server's database and Infra with this app's
 * ACCESS, as the server starts (source/node.ts, and a dev server as it
 * first loads source/server.ts). It never rejects: a failure is logged,
 * and the server goes on, since the login middleware counts only the
 * list's people regardless.
 */
export async function syncAppInternalUsers() {
    const database = appDatabase()
    const infra = appInfra()
    try {
        const synced = await syncInternalUsers(database, infra, ACCESS)
        console.info("The team follows access.ts", synced)
    } catch (error) {
        console.error("The team didn't sync with access.ts", { error })
        return
    }
    try {
        await endConnectionsOfGone(database, infra)
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
