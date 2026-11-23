import { randomUUID } from "node:crypto"
import { DBOSClient } from "@dbos-inc/dbos-sdk"
import { is } from "drizzle-orm"
import { PgTransaction } from "drizzle-orm/pg-core"
import pg from "pg"
import { appDatabaseUrl, type Database } from "@/database"
import type { Workflow } from "./define"
import { APPLICATION, knownWorkflows } from "./engine"
import { EVENTS, type EventData, type EventName } from "./events"
import { workflowsProcess } from "./process"

// Queueing runs from inside a write's own transaction (README.md, "Queueing
// a run with a write"). DBOS keeps its queue in the app's own database, in
// the `dbos` schema, so a run queued on the transaction's connection is
// queued if and only if the transaction commits: a write never lands
// without the work it means, and work never starts for a write that rolled
// back. Whichever process runs the workflows takes it from the queue once
// it's committed, within a second or so.

/**
 * Puts a run of `workflow` on its queue as part of `database`'s
 * transaction, or a transaction of its own when it's handed the pool, and
 * answers the run's id. Its input is checked against the workflow's first,
 * and one that doesn't fit throws, which rolls the transaction back. An
 * `id` names the run after what it's for (`welcome-<contact id>`), so
 * queueing it again finds the run already there, as starting one does.
 * The workflow must be in WORKFLOWS (index.ts), or nothing would run it.
 */
export async function queueWorkflow<Input>(
    database: Database,
    workflow: Workflow<Input>,
    input: Input,
    options: { id?: string } = {}
): Promise<string> {
    if (!is(database, PgTransaction)) {
        return await database.transaction((transaction) =>
            queueWorkflow(transaction, workflow, input, options)
        )
    } else {
        const known = knownWorkflows().some(
            (each) => each.name === workflow.name
        )
        if (!known) {
            throw new Error(
                `The ${workflow.name} workflow isn't in WORKFLOWS (backend/workflows/index.ts)`
            )
        }
        const checked = workflow.input.parse(input)
        const handle = await (await queueing()).enqueueInTransaction(
            connectionOf(database),
            {
                workflowName: workflow.name,
                queueName: workflow.queue,
                workflowID: options.id
            },
            checked
        )
        return handle.workflowID
    }
}

/**
 * Queues a run of every workflow that's `on` the event `name`, with what it
 * carries, as part of `database`'s transaction, or a transaction of its own
 * when it's handed the pool, and answers the runs' ids: none when no
 * workflow is on it, which writes nothing. Each run is named for its
 * workflow and the event (`<workflow>-<event id>`). The event's `id` is
 * new each time unless it's given one that names what happened, like the
 * user who signed up or the delivery a webhook's sender sent, so queueing
 * the same event again queues each workflow once.
 */
export async function queueEvent<Name extends EventName>(
    database: Database,
    name: Name,
    data: EventData<Name>,
    options: { id?: string } = {}
): Promise<string[]> {
    const listening = knownWorkflows().filter((workflow) =>
        workflow.on.includes(name)
    )
    if (listening.length === 0) {
        return []
    }
    if (!is(database, PgTransaction)) {
        return await database.transaction((transaction) =>
            queueEvent(transaction, name, data, options)
        )
    } else {
        const checked = EVENTS[name].parse(data)
        const id = options.id ?? randomUUID()
        const queued: string[] = []
        for (const workflow of listening) {
            queued.push(
                await queueWorkflow(database, workflow, checked, {
                    id: `${workflow.name}-${id}`
                })
            )
        }
        return queued
    }
}

// The client that writes a queued run's row, made once a process. It's
// only ever handed a transaction's connection, so it opens none of its own
// (DBOS makes its pool without connecting it).
function queueing() {
    const held = workflowsProcess()
    held.queueing ??= DBOSClient.create({
        systemDatabaseUrl: held.dependencies?.database_url ?? appDatabaseUrl(),
        systemDatabaseSchemaName: "dbos",
        systemDatabasePoolSize: 1,
        applicationName: APPLICATION
    })
    return held.queueing
}

/**
 * The connection a Drizzle transaction runs on, which DBOS writes the
 * queued run's row through. Drizzle keeps it on the transaction's session
 * and doesn't expose it, so it's read at runtime and checked to be a `pg`
 * client: a Drizzle upgrade that moves it fails here, and in this file's
 * test, rather than queueing outside the transaction.
 */
export function connectionOf(transaction: object): pg.ClientBase {
    const session: unknown = Reflect.get(transaction, "session")
    const client: unknown =
        typeof session === "object" && session !== null
            ? Reflect.get(session, "client")
            : undefined
    if (client instanceof pg.Client) {
        return client
    } else {
        throw new Error("A Drizzle transaction's pg client wasn't where it was")
    }
}
