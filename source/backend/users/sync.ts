import { and, inArray, notInArray, sql } from "drizzle-orm"
import { appDatabase, type Database } from "@/database"
import { users } from "@/database/schema"
import { INTERNAL_ROLES } from "@/utilities/schemas/users"
import {
    ACCESS,
    type Access,
    type InternalUser,
    listedRole,
    nameOf
} from "../auth/access"

/**
 * Makes `users` follow the people access.ts lists as internal, all
 * together: each one is a user, with the name and role they're listed
 * with, made now if they've never logged in, so the People screen and the
 * notices to the team have them from the deploy that lists them; and
 * anyone else the database says is internal is made `external`. Answers how
 * many are listed, how many it made, and how many it made external.
 *
 * The login middleware gives everyone the role the list says whatever
 * this has done (auth/logged-in.ts), so this is what keeps the database
 * telling the same story, not what keeps anyone out.
 */
export async function syncInternalUsers(database: Database, access: Access) {
    // Each address once, lowercased as users keeps it, its first listing
    // winning
    const listed = new Map<string, InternalUser>()
    for (const person of access.internal_users) {
        const email = person.email.trim().toLowerCase()
        if (!listed.has(email)) {
            listed.set(email, person)
        }
    }
    const rows = [...listed].map(([email, person]) => ({
        email,
        name: nameOf(person),
        role: listedRole(person)
    }))
    return await database.transaction(async (transaction) => {
        const upserted =
            rows.length === 0
                ? []
                : await transaction
                      .insert(users)
                      .values(rows)
                      .onConflictDoUpdate({
                          target: users.email,
                          set: {
                              name: sql`excluded.name`,
                              role: sql`excluded.role`
                          }
                      })
                      .returning({
                          // Whether the insert made the row (a comparison, so
                          // a boolean)
                          made: sql<boolean>`xmax = 0`
                      })
        const unlisted = await transaction
            .update(users)
            .set({ role: "external" })
            .where(
                and(
                    inArray(users.role, [...INTERNAL_ROLES]),
                    rows.length === 0
                        ? undefined
                        : notInArray(
                              users.email,
                              rows.map((row) => row.email)
                          )
                )
            )
            .returning({ id: users.id })
        return {
            listed: rows.length,
            made: upserted.filter((row) => row.made).length,
            made_external: unlisted.length
        }
    })
}

/**
 * `syncInternalUsers` on the server's database with this app's ACCESS, as
 * the server starts (source/node.ts, and a dev server as it first loads
 * source/server.ts). It never rejects: a failure is logged, and the server
 * goes on, since the login middleware gives everyone the list's role
 * regardless.
 */
export async function syncAppInternalUsers() {
    try {
        const synced = await syncInternalUsers(appDatabase(), ACCESS)
        console.info("Internal users follow access.ts", synced)
    } catch (error) {
        console.error("The internal users didn't sync with access.ts", {
            error
        })
    }
}
