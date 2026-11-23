import { DBOSClient } from "@dbos-inc/dbos-sdk"
import pg from "pg"
import type { Database } from "@/database"
import { APPLICATION } from "../../engine"

/** A run on a queue, as a test reads it back. */
export type QueuedRun = {
    workflow: string
    id: string
    input: unknown
    queue: string | undefined
}

/**
 * The runs on a test's database's queues, oldest first, read through a
 * DBOS client on its pool, never DBOS's tables: what `queueWorkflow` and
 * `queueEvent` (queue.ts) put there inside a write's transaction, which
 * `context.var.workflows` never sees. Nothing runs them, since no test's
 * API runs the workflows. `testApi()` answers them as `queued()`.
 */
export async function queuedRuns(database: Database): Promise<QueuedRun[]> {
    // Drizzle keeps the pool it was made with as `$client`, which its
    // database's type leaves out
    const pool: unknown = Reflect.get(database, "$client")
    if (!(pool instanceof pg.Pool)) {
        throw new Error("queuedRuns takes a test's database, not a transaction")
    }
    const client = await DBOSClient.create({
        systemDatabaseUrl: pool.options.connectionString ?? "",
        systemDatabasePool: pool,
        systemDatabaseSchemaName: "dbos",
        applicationName: APPLICATION
    })
    try {
        const statuses = await client.listWorkflows({ loadInput: true })
        return statuses.map((status) => ({
            workflow: status.workflowName,
            id: status.workflowID,
            // DBOS keeps a run's arguments as a list; a workflow here takes one
            input: status.input?.[0],
            queue: status.queueName
        }))
    } finally {
        // Leaves the test's pool open, since the client didn't make it
        await client.destroy()
    }
}
