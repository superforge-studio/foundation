import { and, eq, isNull, ne } from "drizzle-orm"
import type { Database } from "@/database"
import { users } from "@/database/schema"

/** Someone by their id: their address and name, or null when they're gone. */
export async function findUser(database: Database, id: string) {
    const [user] = await database
        .select({ email: users.email, name: users.name })
        .from(users)
        .where(eq(users.id, id))
    return user ?? null
}

/**
 * The addresses of the team, whom a notice about the business goes to:
 * everyone access.ts lists, as the server's start and each login keep
 * the database (sync.ts), and no one deactivated, but `except`'s, when
 * the notice is about one of them.
 */
export async function internalEmails(database: Database, except?: string) {
    const rows = await database
        .select({ email: users.email })
        .from(users)
        .where(
            and(
                isNull(users.deactivated_at),
                except === undefined ? undefined : ne(users.id, except)
            )
        )
        .orderBy(users.email)
    return rows.map((row) => row.email)
}
