import { eq } from "drizzle-orm"
import type { Database } from "@/database"
import { users } from "@/database/schema"

/**
 * Removes someone: their row, and with it every session they have, so
 * they're logged out everywhere at once. Logging in again, when anyone may,
 * makes them anew. Never yourself.
 */
export async function removeUser(
    database: Database,
    { id, by }: { id: string; by: string }
): AsyncOperation<null, "yourself" | "not-found"> {
    if (id === by) {
        return { ok: false, error: "yourself" }
    }
    const removed = await database
        .delete(users)
        .where(eq(users.id, id))
        .returning({ id: users.id })
    if (removed.length === 0) {
        return { ok: false, error: "not-found" }
    } else {
        return { ok: true, data: null }
    }
}
