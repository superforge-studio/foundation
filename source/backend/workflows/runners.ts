import type { Database } from "@/database"
import type { Storage } from "@/database/storage"
import { MINUTE } from "@/utilities/primitives/durations"
import { traced } from "@/utilities/tracing"
import type { Workflows } from "./define"

/** What a runner's turn is handed: the process's database, bucket and workflows. */
export type RunnerContext = {
    database: Database
    storage: Storage
    workflows: Workflows
}

/**
 * Something that runs every `every` milliseconds while this process runs
 * the workflows, behind the gate, so one process at a time does: what's
 * just due at a time, kept as a timestamp in Postgres that a runner checks
 * (README.md, "Runners"), like a reminder, or a run started for each row
 * that's due. A feature defines its own in its folder and lists it in
 * index.ts's RUNNERS.
 */
export type Runner = {
    name: string
    every: number
    run: (context: RunnerContext) => Promise<void>
}

// How far apart a runner's turns are for each to be traced, as a trace of
// its own (source/tracing.ts): one every few seconds would fill the traces
// with turns that found nothing due, and what it starts is traced anyway,
// as its workflow's run
const TRACED_EVERY = MINUTE

/**
 * Starts each runner on its timer. A turn never overlaps the one before,
 * and one that throws is logged and the runner goes on. A runner a minute
 * or more apart has each turn traced, as `runner <name>`. Answers what
 * stops them all, which a stop calls before DBOS shuts down.
 */
export function startRunners(runners: Runner[], context: RunnerContext) {
    const timers = runners.map((runner) => {
        let running = false
        const turn =
            runner.every >= TRACED_EVERY
                ? () =>
                      traced(`runner ${runner.name}`, () => runner.run(context))
                : () => runner.run(context)
        return setInterval(() => {
            if (running) {
                return
            }
            running = true
            turn()
                .catch((error: unknown) => {
                    console.error("A runner's turn failed", {
                        runner: runner.name,
                        error
                    })
                })
                .finally(() => {
                    running = false
                })
        }, runner.every)
    })
    return () => {
        for (const timer of timers) {
            clearInterval(timer)
        }
    }
}
