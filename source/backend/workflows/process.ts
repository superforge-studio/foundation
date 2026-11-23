import type { DBOSClient } from "@dbos-inc/dbos-sdk"
import type pg from "pg"
import type { Database } from "@/database"
import type { Storage } from "@/database/storage"
import type { Workflow, WorkflowContext } from "./define"
import type { Runner } from "./runners"

// What this process holds of its workflows, once: whether DBOS is starting
// or running here, the lock that lets it (engine.ts, "the gate"), and each
// workflow as DBOS knows it. Kept on `globalThis`, not in a module, since
// Vite's dev server evaluates a changed module again, and DBOS refuses a
// workflow registered twice, or after it has launched. Apart from engine.ts
// and define.ts, so neither imports the other.

/** What the workflows run with in this process. */
export type WorkflowDependencies = {
    database: Database
    storage: Storage
    // The database DBOS keeps its tables in: the app's own, in `dbos`
    database_url: string
    // Every workflow there is, registered before DBOS launches
    // (index.ts's WORKFLOWS, or a test's own)
    workflows: Workflow[]
    // What runs on a timer while the workflows run here (index.ts's
    // RUNNERS); none when it's left out, as the tests do
    runners?: Runner[]
    // DBOS's connections, fewer for the tests, which share one Postgres
    // with every checkout's (engine.ts's DBOS_POOL_SIZE otherwise)
    dbos_pool_size?: number
}

// A workflow's body, as `defineWorkflow` keeps it: its input still to be
// checked
export type WorkflowBody = (
    input: unknown,
    context: WorkflowContext
) => Promise<unknown>

export type WorkflowsProcess = {
    dependencies: WorkflowDependencies | null
    // Counts the stops, so a start a stop overtook goes no further
    session: number
    // Until DBOS has launched, and after
    starting: Promise<void> | null
    gate: pg.Client | null
    // Pruning finished runs about once an hour, when a copy keeps them for
    // a while rather than for good (engine.ts)
    pruning: ReturnType<typeof setInterval> | null
    // Stops the runners (runners.ts), while the workflows run here
    stop_runners: (() => void) | null
    // For starting a workflow before DBOS has launched here
    client: Promise<DBOSClient> | null
    // For queueing a run inside a write's own transaction (queue.ts), on
    // that transaction's connection, so it holds none of its own
    queueing: Promise<DBOSClient> | null
    // Each workflow's body as evaluated last, by its name, which is what the
    // function DBOS registered runs, so a dev server picks up a change to it
    bodies: Map<string, WorkflowBody>
    // Each workflow as registered with DBOS, by its name
    registered: Map<string, (input: unknown) => Promise<unknown>>
}

declare global {
    // One for the process, whatever evaluates this module again
    var appWorkflowsProcess: WorkflowsProcess | undefined
}

/** This process's workflows. */
export function workflowsProcess(): WorkflowsProcess {
    globalThis.appWorkflowsProcess ??= {
        dependencies: null,
        session: 0,
        starting: null,
        gate: null,
        pruning: null,
        stop_runners: null,
        client: null,
        queueing: null,
        bodies: new Map(),
        registered: new Map()
    }
    return globalThis.appWorkflowsProcess
}
