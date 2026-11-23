import { DBOS, DBOSClient } from "@dbos-inc/dbos-sdk"
import pg from "pg"
import { z } from "zod"
import { appDatabase, appDatabaseUrl } from "@/database"
import { appStorage } from "@/database/storage"
import { HOUR, MINUTE } from "@/utilities/primitives/durations"
import { tracingOn } from "@/utilities/tracing"
import { register, type Workflow, type Workflows } from "./define"
import { RUNNERS, WORKFLOWS } from "./index"
import { type WorkflowDependencies, workflowsProcess } from "./process"
import { QUEUES } from "./queues"
import { startRunners } from "./runners"
import { retryFrom, runOf, runWithStepsOf } from "./runs"

// DBOS in the server: a library that runs workflows in this process and
// keeps their checkpoints in the app's own database, in the `dbos` schema,
// which it makes and migrates itself. README.md has the design.

// What DBOS calls the app in its tables, which a client names too
const APPLICATION = "app"

// Connections, of the 500 Railway's Postgres allows (`max_connections`):
// the app's pool keeps 10 (database/index.ts), DBOS's 10 (its LISTEN among
// them), the client's 2 (only while DBOS hasn't launched here), and the
// gate 1. So a process holds at most 23, and the two that run while a
// deploy goes out 46.
const DBOS_POOL_SIZE = 10
const CLIENT_POOL_SIZE = 2

// The gate's key, in the two-key form of an advisory lock: a pair nothing
// else takes, on the app's database (the local Postgres's idle watch takes
// its own on `postgres`, database/local/idle.ts)
const GATE: [number, number] = [1689, 0]

// How long finished runs are kept, for reading back what one did: for
// good, as the template ships, since a run and its steps are the record of
// what the business's background work did. A copy whose runs grow too many
// for its database sets a duration instead (`90 * DAY`), and the runs that
// finished longer ago than that are then pruned about once an hour
const KEEP_FINISHED_FOR: number | "forever" = "forever"
const PRUNE_EVERY = HOUR
const PRUNE_PAGE = 1000

// How long a start that failed waits to try again
const START_AGAIN_AFTER = MINUTE

// What trying for the gate answers
const taken_row = z.object({ taken: z.boolean() })

/** The server's own: its database and bucket, every workflow and runner. */
export function appWorkflowDependencies(): WorkflowDependencies {
    return {
        database: appDatabase(),
        storage: appStorage(),
        database_url: appDatabaseUrl(),
        workflows: WORKFLOWS,
        runners: RUNNERS
    }
}

/**
 * Runs the workflows in this process, once: registers every one, takes the
 * gate, launches DBOS, which recovers whatever runs were left unfinished,
 * and opens the queues. Resolves once all that's done, which can be a long
 * while: until the process holding the gate exits. It never rejects: a
 * start that fails is logged, lets go of what it took, and tries again a
 * minute later.
 *
 * The gate is a session advisory lock taken before DBOS launches and held
 * for the process's life. DBOS recovers every unfinished run as it
 * launches, even one another live process is running, and Railway runs the
 * old and new deployments side by side while a deploy goes out, so without
 * it both would run the same step. With it, a new deployment waits,
 * answering its healthcheck, until Railway has stopped the old one, then
 * launches within a moment. Until then, a workflow it starts goes on its
 * queue through a DBOS client.
 */
export function startWorkflows(
    dependencies: WorkflowDependencies = appWorkflowDependencies()
): Promise<void> {
    const held = workflowsProcess()
    const session = held.session
    held.starting ??= launch(dependencies, session).catch(async (error) => {
        // A stop that came meanwhile is why it failed, if it did
        if (
            error instanceof Stopped ||
            workflowsProcess().session !== session
        ) {
            return
        }
        console.error("The workflows couldn't start, so they try again soon", {
            error
        })
        await stopWorkflows()
        setTimeout(() => {
            startWorkflows(dependencies)
        }, START_AGAIN_AFTER).unref()
    })
    return held.starting
}

// A start that a stop overtook, which goes no further
class Stopped extends Error {}

async function launch(dependencies: WorkflowDependencies, session: number) {
    const held = workflowsProcess()
    // Each step only goes on while no stop has come since the start
    const going = () => {
        if (held.session !== session) {
            throw new Stopped()
        }
    }
    held.dependencies = dependencies
    for (const workflow of dependencies.workflows) {
        register(workflow)
    }

    await takeGate(dependencies.database_url, (gate) => {
        held.gate = gate
    })
    going()
    DBOS.setConfig({
        name: APPLICATION,
        systemDatabaseUrl: dependencies.database_url,
        systemDatabaseSchemaName: "dbos",
        systemDatabasePoolSize: dependencies.dbos_pool_size ?? DBOS_POOL_SIZE,
        // So a deploy's new code recovers the runs the old one left: without
        // it, DBOS versions the app by a hash of its code, and only runs a
        // run under the version that started it, which every deploy changes
        enablePatching: true,
        // A span for each run, named for its workflow, and one inside it
        // for each step, named for the step, while this process traces
        // (source/tracing.ts), made with its provider, never DBOS's own
        // exporter. Their attributes take OpenTelemetry's style
        // (`dbos.operation.workflow_id`), which Railway's Traces page finds
        // a run's trace by.
        tracingEnabled: tracingOn(),
        otelAttributeFormat: "semconv"
    })
    await DBOS.launch()
    if (held.session !== session) {
        // A stop that came while DBOS launched found nothing to shut down
        await DBOS.shutdown()
        throw new Stopped()
    }
    // DBOS itself starts workflows from here on, so the client's
    // connections go
    const client = held.client
    held.client = null
    await closeClient(client)
    for (const [name, options] of Object.entries(QUEUES)) {
        await DBOS.registerQueue(name, options)
    }
    going()

    held.pruning = pruneOnSchedule(KEEP_FINISHED_FOR)
    held.stop_runners = startRunners(dependencies.runners ?? [], {
        database: dependencies.database,
        storage: dependencies.storage,
        workflows: dbosWorkflows
    })
    console.info("The workflows are running", {
        application_version: DBOS.applicationVersion
    })
}

/**
 * Stops the workflows in this process, as Railway stops the old deployment
 * (source/node.ts): DBOS shut down with its runs left where they are, and
 * the gate let go, so the next process launches and carries them on. A run
 * cut off mid-step runs that step again there: every step can. A start
 * still waiting at the gate stops waiting.
 */
export async function stopWorkflows() {
    const held = workflowsProcess()
    const { gate, client, pruning, stop_runners } = held
    held.session += 1
    Object.assign(held, {
        starting: null,
        gate: null,
        pruning: null,
        stop_runners: null,
        client: null
    })
    if (pruning !== null) {
        clearInterval(pruning)
    }
    stop_runners?.()
    if (DBOS.isInitialized()) {
        await DBOS.shutdown()
    }
    await gate?.end()
    await closeClient(client)
    console.info("The workflows stopped")
}

// Closes a client, if one was made: one that failed to be made has already
// failed whoever asked for it
async function closeClient(client: Promise<DBOSClient> | null) {
    try {
        await (await client)?.destroy()
    } catch (error) {
        console.error("The DBOS client didn't close", { error })
    }
}

/**
 * Starting workflows, and reading and retrying their runs: through DBOS
 * itself once it has launched in this process, and through a client before
 * then, onto the workflow's queue either way, for whichever process runs
 * it. Runs are read through DBOS's own functions, never its tables, which
 * are DBOS's to change. The server's `context.var.workflows`.
 */
export const dbosWorkflows: Workflows = {
    async start(workflow, input, options = {}) {
        const registered = workflowsProcess().registered.get(workflow.name)
        if (registered === undefined) {
            throw new Error(
                `The ${workflow.name} workflow isn't in WORKFLOWS (backend/workflows/index.ts)`
            )
        }
        const handle = DBOS.isInitialized()
            ? await DBOS.startWorkflow(registered, {
                  workflowID: options.id,
                  queueName: workflow.queue
              })(input)
            : await (await dbosClient()).enqueue(
                  {
                      workflowName: workflow.name,
                      queueName: workflow.queue,
                      workflowID: options.id
                  },
                  input
              )
        console.info("A workflow was put on its queue", {
            workflow: workflow.name,
            id: handle.workflowID
        })
        return handle.workflowID
    },

    async runs({ limit = 100 } = {}) {
        // DBOS loads a failed run's error with its output, and the list
        // says why each failed
        const listing = {
            sortDesc: true,
            limit,
            loadInput: true,
            loadOutput: true
        }
        const statuses = DBOS.isInitialized()
            ? await DBOS.listWorkflows(listing)
            : await (await dbosClient()).listWorkflows(listing)
        return statuses.map((status) => runOf(status, knownWorkflows()))
    },

    async run(id) {
        const listing = { workflowIDs: [id], loadInput: true, loadOutput: true }
        const [status] = DBOS.isInitialized()
            ? await DBOS.listWorkflows(listing)
            : await (await dbosClient()).listWorkflows(listing)
        if (status === undefined) {
            return null
        } else {
            const steps = DBOS.isInitialized()
                ? await DBOS.listWorkflowSteps(id)
                : await (await dbosClient()).listWorkflowSteps(id)
            return runWithStepsOf(status, steps ?? [], knownWorkflows())
        }
    },

    async retry(id) {
        const run = await dbosWorkflows.run(id)
        if (run === null) {
            return { ok: false, error: "not-found" }
        } else if (run.status !== "failed" && run.status !== "canceled") {
            return { ok: false, error: "not-stopped" }
        } else {
            // DBOS drops what the run kept from this step on, and puts it
            // back on its workflow's queue under the same id
            const options = {
                startStep: retryFrom(run.steps),
                queueName: knownWorkflows().find(
                    (workflow) => workflow.name === run.workflow
                )?.queue
            }
            if (DBOS.isInitialized()) {
                await DBOS.rewindWorkflow(id, options)
            } else {
                await (await dbosClient()).rewindWorkflow(id, options)
            }
            console.info("A stopped run was started again", {
                id,
                workflow: run.workflow,
                from_step: options.startStep
            })
            return { ok: true, data: null }
        }
    }
}

// The workflows this process knows, which name their runs: the ones it
// started with, or every one there is before it has
function knownWorkflows(): Workflow[] {
    return workflowsProcess().dependencies?.workflows ?? WORKFLOWS
}

/**
 * Puts runs on their workflows' queues from a script, like the seed, which
 * runs no workflows itself: through a DBOS client of its own, on the
 * database at `url`, closed once they're queued. Whichever process runs
 * the workflows there, like a dev server, then runs them.
 */
export async function enqueueFromScript(
    url: string,
    runs: { workflow: Workflow<unknown>; input: unknown; id: string }[]
) {
    const client = await DBOSClient.create({
        systemDatabaseUrl: url,
        systemDatabaseSchemaName: "dbos",
        systemDatabasePoolSize: 1,
        applicationName: APPLICATION
    })
    try {
        for (const { workflow, input, id } of runs) {
            await client.enqueue(
                {
                    workflowName: workflow.name,
                    queueName: workflow.queue,
                    workflowID: id
                },
                input
            )
        }
    } finally {
        await client.destroy()
    }
}

// The client, made the first time it's needed
function dbosClient() {
    const held = workflowsProcess()
    held.client ??= DBOSClient.create({
        systemDatabaseUrl: held.dependencies?.database_url ?? appDatabaseUrl(),
        systemDatabaseSchemaName: "dbos",
        systemDatabasePoolSize: CLIENT_POOL_SIZE,
        applicationName: APPLICATION
    })
    return held.client
}

/**
 * Prunes the runs that finished longer ago than `keep`, about once an
 * hour, or none ever, when they're kept for good. Answers the interval,
 * for a stop to clear.
 */
function pruneOnSchedule(keep: number | "forever") {
    if (keep === "forever") {
        return null
    } else {
        return setInterval(() => {
            pruneFinishedRuns(Date.now() - keep).catch((error) => {
                console.error("Pruning finished runs failed", { error })
            })
        }, PRUNE_EVERY)
    }
}

/**
 * Deletes the runs that finished before `before`, through DBOS, which
 * takes each one's steps, input and output with it. DBOS never prunes on
 * its own, and its tables gain a row with every step. Never delete their
 * rows by hand: only `workflow_status` names a run, so its steps would be
 * left behind. Answers how many it deleted.
 */
export async function pruneFinishedRuns(before: number) {
    let deleted = 0
    for (;;) {
        const finished = await DBOS.listWorkflows({
            status: [
                "SUCCESS",
                "ERROR",
                "CANCELLED",
                "MAX_RECOVERY_ATTEMPTS_EXCEEDED"
            ],
            completedBefore: new Date(before).toISOString(),
            limit: PRUNE_PAGE,
            loadInput: false,
            loadOutput: false
        })
        if (finished.length === 0) {
            break
        }
        await DBOS.deleteWorkflows(finished.map((run) => run.workflowID))
        deleted += finished.length
        if (finished.length < PRUNE_PAGE) {
            break
        }
    }
    if (deleted > 0) {
        console.info("Finished runs were pruned", { deleted })
    }
    return deleted
}

/**
 * Takes the gate on a connection of its own, waiting for whoever holds it.
 * The connection holds it until it closes, so it's handed to `holding` as
 * soon as it's open, for a stop to end it, waiting or not. Losing the
 * connection loses the lock, so another process could launch beside this
 * one: that's logged, and this process stops its workflows and starts them
 * again behind the gate.
 */
export async function takeGate(
    url: string,
    holding: (gate: pg.Client) => void
): Promise<void> {
    const gate = new pg.Client({
        connectionString: url,
        application_name: "app workflows gate"
    })
    // Once it holds the lock, losing it is the workflows' to recover from;
    // a failure before then fails the start, which tries again
    let taken = false
    gate.on("error", (error) => {
        console.error("The connection holding the workflows' gate failed", {
            taken,
            error
        })
        if (taken && workflowsProcess().gate === gate) {
            restartWorkflows()
        }
    })
    holding(gate)
    await gate.connect()
    const [first, second] = GATE
    const { rows } = await gate.query(
        "select pg_try_advisory_lock($1, $2) as taken",
        [first, second]
    )
    if (!taken_row.parse(rows[0]).taken) {
        console.info(
            "Waiting at the workflows' gate, which another process holds"
        )
        await gate.query("select pg_advisory_lock($1, $2)", [first, second])
    }
    taken = true
    console.info("Took the workflows' gate")
}

async function restartWorkflows() {
    const { dependencies } = workflowsProcess()
    await stopWorkflows()
    if (dependencies !== null) {
        await startWorkflows(dependencies)
    }
}
