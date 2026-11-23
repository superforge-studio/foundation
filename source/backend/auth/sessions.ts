import { and, desc, eq, gt, inArray, like, lt, ne, sql } from "drizzle-orm"
import type { Database } from "@/database"
import { sessions, users } from "@/database/schema"
import { fromNow, now } from "@/database/time"
import { DAY } from "@/utilities/primitives/durations"
import { randomToken, sha256 } from "./tokens"

// The sessions, in `auth.sessions`: operations on them by their token, which
// only the browser's cookie holds (logged-in.ts), and by their id, for the
// account page. Nothing else reads the cookie or this table: a route that
// needs the user uses `loggedIn`.

/**
 * How long a session lasts from when it was last renewed, so someone who
 * keeps coming back never has to log in again.
 */
export const SESSION_LIFETIME = 30 * DAY

// A session in use is renewed at most this often, which spares the table a
// write on every request
const RENEW_EVERY = DAY
const RENEW_BEFORE = fromNow(SESSION_LIFETIME - RENEW_EVERY)

// What a session is called outside this file: the start of its token's
// hash, enough to tell someone's sessions apart, and nothing a browser can
// log in with
const ID_LENGTH = 16

/** A session's id, from its token's hash. */
export function sessionId(token_hash: string) {
    return token_hash.slice(0, ID_LENGTH)
}

/**
 * Who a session logs in, as every route that needs them sees them: who
 * they are, what they're called, their role, and when they first logged in.
 */
export type SessionUser = Pick<
    typeof users.$inferSelect,
    "id" | "email" | "name" | "role" | "created_at"
>

/** The columns a SessionUser is read from. */
export const SESSION_USER_COLUMNS = {
    id: users.id,
    email: users.email,
    name: users.name,
    role: users.role,
    created_at: users.created_at
}

/**
 * Starts a session for this user, ending the one this browser had
 * (`replacing`, its cookie's token), and answers its token, for the
 * cookie. Their sessions that have run out are cleared away with it. A
 * user who never logs in again leaves theirs, which no request accepts
 * (`liveSession`): a workflow can prune them once there are enough to
 * matter. `user_agent` is the browser's, for the account page.
 */
export async function startSession(
    database: Database,
    user_id: string,
    replacing: string | undefined,
    user_agent: string | null
) {
    if (replacing !== undefined) {
        await endSession(database, replacing)
    }
    await database
        .delete(sessions)
        .where(and(eq(sessions.user_id, user_id), lt(sessions.expires_at, now)))

    const token = randomToken()
    await database.insert(sessions).values({
        token_hash: await sha256(token),
        user_id,
        user_agent,
        expires_at: fromNow(SESSION_LIFETIME)
    })
    return token
}

/** Ends the session behind this token, if it's still there. */
export async function endSession(database: Database, token: string) {
    await database
        .delete(sessions)
        .where(eq(sessions.token_hash, await sha256(token)))
}

/**
 * The live session behind this token, with its user, its id, and whether
 * it's been long enough since it was renewed to renew it again; undefined
 * for a token with none, or one that has run out.
 */
export async function liveSession(database: Database, token: string) {
    const [session] = await database
        .select({
            user: SESSION_USER_COLUMNS,
            token_hash: sessions.token_hash,
            // A comparison, so Postgres answers a boolean
            renewable: sql<boolean>`${sessions.expires_at} < ${RENEW_BEFORE}`
        })
        .from(sessions)
        .innerJoin(users, eq(sessions.user_id, users.id))
        .where(
            and(
                eq(sessions.token_hash, await sha256(token)),
                gt(sessions.expires_at, now)
            )
        )
    if (session === undefined) {
        return undefined
    } else {
        const { token_hash, ...rest } = session
        return { ...rest, id: sessionId(token_hash) }
    }
}

/**
 * Gives the session behind this token its whole lifetime again, and says
 * whether this call was the one that did: of the requests a page makes at
 * once, only one is, and a session logged out of meanwhile has nothing to
 * renew.
 */
export async function renewSession(database: Database, token: string) {
    const renewed = await database
        .update(sessions)
        .set({ expires_at: fromNow(SESSION_LIFETIME) })
        .where(
            and(
                eq(sessions.token_hash, await sha256(token)),
                lt(sessions.expires_at, RENEW_BEFORE)
            )
        )
        .returning({ token_hash: sessions.token_hash })
    return renewed.length > 0
}

/**
 * Someone's live sessions, newest first: where each is, when it started,
 * and when it was last renewed, which is when it was last used, to within
 * a day (RENEW_EVERY).
 */
export async function listSessions(database: Database, user_id: string) {
    const rows = await database
        .select({
            token_hash: sessions.token_hash,
            user_agent: sessions.user_agent,
            created_at: sessions.created_at,
            expires_at: sessions.expires_at
        })
        .from(sessions)
        .where(and(eq(sessions.user_id, user_id), gt(sessions.expires_at, now)))
        .orderBy(desc(sessions.expires_at))
    return rows.map(({ token_hash, expires_at, ...row }) => ({
        ...row,
        id: sessionId(token_hash),
        renewed_at: new Date(expires_at.getTime() - SESSION_LIFETIME),
        expires_at
    }))
}

/**
 * Ends one of someone's sessions by its id, as the account page's "Log
 * out" beside it does; never another person's.
 */
export async function endSessionById(
    database: Database,
    user_id: string,
    id: string
): AsyncOperationResult<null, "not-found"> {
    const ended = await database
        .delete(sessions)
        .where(
            and(
                eq(sessions.user_id, user_id),
                like(sessions.token_hash, `${id}%`)
            )
        )
        .returning({ token_hash: sessions.token_hash })
    if (ended.length === 0) {
        return { ok: false, error: "not-found" }
    } else {
        return { ok: true, data: null }
    }
}

/**
 * Ends every session someone has but the one with this id, the one they're
 * using, and answers how many.
 */
export async function endOtherSessions(
    database: Database,
    user_id: string,
    keeping: string
) {
    const ended = await database
        .delete(sessions)
        .where(
            and(
                eq(sessions.user_id, user_id),
                ne(sql`left(${sessions.token_hash}, ${ID_LENGTH})`, keeping)
            )
        )
        .returning({ token_hash: sessions.token_hash })
    return ended.length
}

/**
 * How many sessions have run out: rows no request accepts any more, which
 * the `prune-sessions` job deletes (jobs.ts)
 */
export async function countExpiredSessions(database: Database) {
    const [counted] = await database
        .select({ expired: sql<number>`count(*)::integer` })
        .from(sessions)
        .where(lt(sessions.expires_at, now))
    return counted?.expired ?? 0
}

/** Deletes up to `limit` sessions that have run out, and answers how many */
export async function deleteExpiredSessions(database: Database, limit: number) {
    const expired = database
        .select({ token_hash: sessions.token_hash })
        .from(sessions)
        .where(lt(sessions.expires_at, now))
        .limit(limit)
    const deleted = await database
        .delete(sessions)
        .where(inArray(sessions.token_hash, expired))
        .returning({ token_hash: sessions.token_hash })
    return deleted.length
}
