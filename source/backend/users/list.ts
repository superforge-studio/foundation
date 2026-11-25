import { and, desc, eq, gt, sql } from "drizzle-orm"
import type { Database } from "@/database"
import { sessions, users } from "@/database/schema"
import { now } from "@/database/time"
import { type Access, listedAs, permissionsOf, roleOf } from "../auth/access"

/**
 * The team, for the admin's Settings: everyone auth/app.ts lists,
 * and everyone it once did, who's deactivated, newest first, with their
 * slug, address and name, whether the list has them now, with what role
 * and what it lets them do in each area (both null once they're off it),
 * when they were deactivated, joined and last logged in, and how many
 * browsers they're logged in on now.
 */
export async function listUsers(database: Database, access: Access) {
    const rows = await database
        .select({
            id: users.id,
            slug: users.slug,
            email: users.email,
            name: users.name,
            deactivated_at: users.deactivated_at,
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
    return rows.map((row) => {
        const listed = listedAs(access, row)
        const role = listed === undefined ? null : roleOf(listed)
        return {
            ...row,
            listed: listed !== undefined,
            role,
            permissions: role === null ? null : permissionsOf(access, role)
        }
    })
}
