import { sql } from "drizzle-orm"
import type { Database } from "@/database"

/**
 * Whether the database answers. An operation, as every function that
 * touches the database is: it takes the database and its input, and
 * answers what happened, for a route or a workflow's step to act on.
 */
export async function checkDatabase(
    database: Database
): AsyncOperationResult<null, "database-unreachable"> {
    try {
        await database.execute(sql`select 1`)
        return { ok: true, data: null }
    } catch (error) {
        console.error("Database health check failed", { error })
        return { ok: false, error: "database-unreachable" }
    }
}
