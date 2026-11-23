import { and, desc, eq, gt, sql } from "drizzle-orm"
import type { Database } from "@/database"
import { sessions, users } from "@/database/schema"
import { now } from "@/database/time"
import { type Access, listedInternal, roleFor } from "../auth/access"

/**
 * Everyone who can log in, newest first, for the dashboard's People
 * screen: who they are, their role, as access.ts gives it, whether they're
 * listed there as one of the business's own, when they joined and last
 * logged in, and how many browsers they're logged in on now.
 */
export async function listUsers(database: Database, access: Access) {
    const rows = await database
        .select({
            id: users.id,
            email: users.email,
            name: users.name,
            role: users.role,
            created_at: users.created_at,
            logged_in_at: users.logged_in_at,
            // count() answers a bigint, which pg hands over as a string
            sessions: sql<number>`count(${sessions.token_hash})::integer`
        })
        .from(users)
        .leftJoin(
            sessions,
            and(eq(sessions.user_id, users.id), gt(sessions.expires_at, now))
        )
        .groupBy(users.id)
        .orderBy(desc(users.created_at))
    return rows.map((row) => ({
        ...row,
        role: roleFor(access, row.email, row.role),
        listed: listedInternal(access, row.email) !== undefined
    }))
}

/** Someone on the People screen, as `listUsers` answers them. */
export type ListedUser = Awaited<ReturnType<typeof listUsers>>[number]
