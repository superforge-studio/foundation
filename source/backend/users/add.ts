import type { z } from "zod"
import type { Database } from "@/database"
import { users } from "@/database/schema"
import type { user_addition } from "@/utilities/schemas/users"

/**
 * Adds someone before they've logged in, with their role, so they can log
 * in when only listed people may (backend/auth/access.ts), and are already
 * what they should be when they do. Refuses an address someone has.
 */
export async function addUser(
    database: Database,
    addition: z.output<typeof user_addition>
): AsyncOperationResult<{ id: string }, "taken"> {
    const [added] = await database
        .insert(users)
        .values({
            email: addition.email,
            name: addition.name ?? null,
            role: addition.role
        })
        .onConflictDoNothing({ target: users.email })
        .returning({ id: users.id })
    if (added === undefined) {
        return { ok: false, error: "taken" }
    } else {
        return { ok: true, data: added }
    }
}
