import { eq } from "drizzle-orm"
import type { Database } from "@/database"
import { users } from "@/database/schema"
import type { Role } from "@/utilities/schemas/users"

/**
 * Gives someone another role, which changes what of the dashboard they see
 * from their next request. Never your own, so the business always has
 * someone who can change it back.
 */
export async function changeRole(
    database: Database,
    { id, role, by }: { id: string; role: Role; by: string }
): AsyncOperationResult<null, "yourself" | "not-found"> {
    if (id === by) {
        return { ok: false, error: "yourself" }
    }
    const changed = await database
        .update(users)
        .set({ role })
        .where(eq(users.id, id))
        .returning({ id: users.id })
    if (changed.length === 0) {
        return { ok: false, error: "not-found" }
    } else {
        return { ok: true, data: null }
    }
}
