import { and, eq, inArray, ne } from "drizzle-orm"
import type { Database } from "@/database"
import { users } from "@/database/schema"
import { INTERNAL_ROLES } from "@/utilities/schemas/users"

/** Someone by their id: their address and name, or null when they're gone. */
export async function findUser(database: Database, id: string) {
    const [user] = await database
        .select({ email: users.email, name: users.name })
        .from(users)
        .where(eq(users.id, id))
    return user ?? null
}

/**
 * The addresses of the business's own people, whom a notice about the
 * business goes to, but `except`'s, like the person the notice is about:
 * the users access.ts lists, as the server's start and each login keep
 * the database (sync.ts).
 */
export async function internalEmails(database: Database, except: string) {
    const rows = await database
        .select({ email: users.email })
        .from(users)
        .where(
            and(inArray(users.role, [...INTERNAL_ROLES]), ne(users.id, except))
        )
        .orderBy(users.email)
    return rows.map((row) => row.email)
}
