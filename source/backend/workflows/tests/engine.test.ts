import { randomUUID } from "node:crypto"
import { setTimeout as sleep } from "node:timers/promises"
import { DBOS } from "@dbos-inc/dbos-sdk"
import { sql } from "drizzle-orm"
import type pg from "pg"
import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    inject,
    test,
    vi
} from "vitest"
import { z } from "zod"
import { connect } from "@/database"
import { Storage } from "@/database/storage"
import { databaseUrl, onServer, quoted } from "@/database/tests/support/server"
import { memoryStore } from "@/database/tests/support/storage"
import { HOUR } from "@/utilities/primitives/durations"
import { defineWorkflow, scheduled_input } from "../define"
import {
    dbosWorkflows,
    pruneFinishedRuns,
    scheduledFunction,
    startWorkflows,
    stopWorkflows,
    takeGate
} from "../engine"
import { type WorkflowDependencies, workflowsProcess } from "../process"
import { queueWorkflow } from "../queue"

// The workflows on DBOS itself, in real time, on a database of their own:
// the gate, a run started before DBOS has launched, a run that carries on
// after a restart, and pruning. DBOS is one per process, so these run one
// after another, on one database, each going on from the one before.

const name = `app_test_${randomUUID().replaceAll("-", "")}`
const url = databaseUrl(name)
const database = connect(url, 2)

// How many times each run's steps have run, by the run's name
const ran = new Map<string, { first: number; second: number }>()
// Runs whose second step never returns the first time it runs, the way a
// process that stops mid-step leaves it
const stuck = new Set<string>()

const twoSteps = defineWorkflow({
    name: "two-steps",
    input: z.object({ run: z.string() }),
    run: async ({ run }, context) => {
        const counts = ran.get(run) ?? { first: 0, second: 0 }
        ran.set(run, counts)
        const first = await context.step("first", async () => {
            counts.first += 1
            return `first of ${run}`
        })
        const second = await context.step("second", async () => {
            counts.second += 1
            if (stuck.has(run) && counts.second === 1) {
                await new Promise(() => {})
            }
            return `second of ${run}`
        })
        return [first, second]
    }
})

// Runs that fail between their two steps the first time, the way a body
// that throws outside a step fails a run at once, with no retries
const failing = new Set<string>()

const breaksOnce = defineWorkflow({
    name: "breaks-once",
    input: z.object({ run: z.string() }),
    title: ({ run }) => `Break ${run}`,
    run: async ({ run }, context) => {
        const counts = ran.get(run) ?? { first: 0, second: 0 }
        ran.set(run, counts)
        await context.step("first", async () => {
            counts.first += 1
            return { run }
        })
        if (failing.has(run)) {
            throw new Error(`${run} broke`)
        }
        await context.step("second", async () => {
            counts.second += 1
            return { done: true }
        })
        return "fixed"
    }
})

// Plumbing, whose runs stay off the list unless one fails: one fails at
// once when it's told to
const quietly = defineWorkflow({
    name: "quietly",
    input: z.object({ run: z.string(), fail: z.boolean() }),
    quiet: true,
    run: async ({ run, fail }, context) => {
        if (fail) {
            throw new Error(`${run} broke`)
        }
        return await context.step("only", async () => run)
    }
})

// On a schedule that won't come round while the tests run, so a test fires
// it itself: answers the moment it fired
const yearly = defineWorkflow({
    name: "yearly",
    input: scheduled_input,
    schedule: "0 0 1 1 *",
    title: ({ scheduled_at }) => `New year, ${scheduled_at}`,
    run: async ({ scheduled_at }, context) =>
        await context.step("only", async () => scheduled_at)
})

const dependencies: WorkflowDependencies = {
    database,
    storage: new Storage(memoryStore().store),
    database_url: url,
    workflows: [twoSteps, breaksOnce, quietly, yearly],
    // This machine's Postgres is every checkout's
    dbos_pool_size: 4
}

// A run's status as DBOS's own table has it, for while DBOS isn't running
const status_row = z.object({ status: z.string() })
async function storedStatus(id: string) {
    const { rows } = await database.$client.query(
        "select status from dbos.workflow_status where workflow_uuid = $1",
        [id]
    )
    return status_row.parse(rows[0]).status
}

beforeAll(async () => {
    // A copy of the run's template, which every migration, DBOS's among
    // them, was applied to
    await onServer((client) =>
        client.query(
            `create database ${quoted(name)} template ${quoted(inject("database_template"))}`
        )
    )
})

beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {})
})

afterAll(async () => {
    await stopWorkflows()
    await database.$client.end()
    await onServer((client) =>
        client.query(`drop database ${quoted(name)} with (force)`)
    )
})

describe("the workflows on DBOS", { timeout: 60_000 }, () => {
    test("wait at the gate, take a run on its queue meanwhile, then run it", async () => {
        // The deployment before this one, holding the gate
        let before: pg.Client | undefined
        await takeGate(url, (gate) => {
            before = gate
        })
        const starting = startWorkflows(dependencies)
        await sleep(500)
        expect(DBOS.isInitialized()).toBe(false)

        // Starting one meanwhile puts it on its queue through a client, and
        // starting it twice under its id is harmless
        const id = await dbosWorkflows.start(twoSteps, { run: "queued" })
        await dbosWorkflows.start(twoSteps, { run: "queued" }, { id })

        // The deployment before exits, which lets this one launch
        await before?.end()
        await starting
        expect(DBOS.isInitialized()).toBe(true)
        // Finished runs are kept for good, so nothing prunes them
        expect(workflowsProcess().pruning).toBeNull()

        expect(await DBOS.retrieveWorkflow(id).getResult()).toEqual([
            "first of queued",
            "second of queued"
        ])
        expect(ran.get("queued")).toEqual({ first: 1, second: 1 })
    })

    test("carry a run cut off mid-step on after a restart, without its finished steps again", async () => {
        stuck.add("restarted")
        const id = await dbosWorkflows.start(twoSteps, { run: "restarted" })
        await vi.waitFor(() => expect(ran.get("restarted")?.second).toBe(1), {
            timeout: 10_000,
            interval: 100
        })

        // The process stops mid-step, as Railway stops the old deployment,
        // and the run is left where it was
        await stopWorkflows()
        expect(DBOS.isInitialized()).toBe(false)
        expect(await storedStatus(id)).toBe("PENDING")

        // The next process takes the gate and launches, and carries it on
        // from the step it was in
        await startWorkflows(dependencies)
        expect(await DBOS.retrieveWorkflow(id).getResult()).toEqual([
            "first of restarted",
            "second of restarted"
        ])
        expect(ran.get("restarted")).toEqual({ first: 1, second: 2 })
    })

    test("read runs and their steps through DBOS, and run a failed one again from where it stopped", async () => {
        failing.add("broken")
        const id = await dbosWorkflows.start(breaksOnce, { run: "broken" })
        await expect(DBOS.retrieveWorkflow(id).getResult()).rejects.toThrow(
            "broken broke"
        )

        const runs = await dbosWorkflows.runs()
        const listed = runs.find((run) => run.id === id)
        expect(listed).toMatchObject({
            workflow: "breaks-once",
            title: "Break broken",
            status: "failed",
            error: "broken broke"
        })
        expect(runs.filter((run) => run.status === "succeeded")).not.toEqual([])

        const failed = await dbosWorkflows.run(id)
        expect(failed?.steps.map((step) => [step.name, step.status])).toEqual([
            ["first", "done"]
        ])

        // Fixed, it runs again from just after its first step, which keeps
        // what it returned and doesn't run again
        failing.delete("broken")
        expect(await dbosWorkflows.retry(id)).toEqual({ ok: true, data: null })
        expect(await DBOS.retrieveWorkflow(id).getResult()).toBe("fixed")
        expect(ran.get("broken")).toEqual({ first: 1, second: 1 })
        const fixed = await dbosWorkflows.run(id)
        expect(fixed?.status).toBe("succeeded")
        expect(fixed?.steps.map((step) => step.name)).toEqual([
            "first",
            "second"
        ])

        // One that didn't fail, or isn't there, doesn't run again
        expect(await dbosWorkflows.retry(id)).toEqual({
            ok: false,
            error: "not-stopped"
        })
        expect(await dbosWorkflows.retry("no-such-run")).toEqual({
            ok: false,
            error: "not-found"
        })
    })

    test("run what a write queued once it commits, and list a quiet run only once it fails", async () => {
        const queued = await database.transaction(async (transaction) => ({
            fine: await queueWorkflow(transaction, quietly, {
                run: "fine",
                fail: false
            }),
            broken: await queueWorkflow(transaction, quietly, {
                run: "broken",
                fail: true
            })
        }))
        expect(await DBOS.retrieveWorkflow(queued.fine).getResult()).toBe(
            "fine"
        )
        await expect(
            DBOS.retrieveWorkflow(queued.broken).getResult()
        ).rejects.toThrow("broken broke")

        // The failed one is listed with the others; the fine one isn't, but
        // still opens by its id
        const listed = (await dbosWorkflows.runs()).map((run) => run.id)
        expect(listed).toContain(queued.broken)
        expect(listed).not.toContain(queued.fine)
        expect(listed.length).toBeGreaterThan(1)
        expect((await dbosWorkflows.run(queued.fine))?.status).toBe("succeeded")

        // However many quiet runs come after it, as three weeks of hourly
        // ones would: copies of the fine one's row, each newer than the last
        await database.execute(
            sql.raw(`
            do $$
            begin
                create temp table copies on commit drop as
                    select * from dbos.workflow_status
                    where workflow_uuid = '${queued.fine}';
                for counted in 1..1100 loop
                    update copies set
                        workflow_uuid = gen_random_uuid()::text,
                        created_at = created_at + 1;
                    insert into dbos.workflow_status select * from copies;
                end loop;
            end $$
        `)
        )
        const still = (await dbosWorkflows.runs()).map((run) => run.id)
        expect(still).toContain(queued.broken)
    })

    test("apply each workflow's schedule as DBOS launches, fire it, and delete a schedule no workflow has", async () => {
        const named = async () =>
            (await DBOS.listSchedules()).map(
                (schedule) => schedule.scheduleName
            )
        expect(await named()).toEqual(["yearly"])

        // Fired, its run takes the moment as its input, and is named from it
        const handle = await DBOS.triggerSchedule("yearly")
        const fired = await handle.getResult()
        expect(z.string().datetime().safeParse(fired).success).toBe(true)
        const listed = (await dbosWorkflows.runs()).find(
            (run) => run.id === handle.workflowID
        )
        expect(listed?.title).toBe(`New year, ${fired}`)

        // A schedule left from a workflow that's gone, which the next
        // launch deletes
        await DBOS.applySchedules([
            {
                scheduleName: "gone",
                workflowFn: scheduledFunction(yearly),
                schedule: "0 0 1 1 *"
            }
        ])
        expect((await named()).sort()).toEqual(["gone", "yearly"])
        await stopWorkflows()
        await startWorkflows(dependencies)
        expect(await named()).toEqual(["yearly"])
    })

    test("prune finished runs, steps and all", async () => {
        const finished = await DBOS.listWorkflows({})
        expect(finished.length).toBeGreaterThan(0)

        // Nothing finished an hour ago, and everything has by a moment from
        // now
        expect(await pruneFinishedRuns(Date.now() - HOUR)).toBe(0)
        expect(await pruneFinishedRuns(Date.now() + 1000)).toBe(finished.length)

        expect(await DBOS.listWorkflows({})).toEqual([])
        const { rows } = await database.$client.query(
            "select count(*)::int as steps from dbos.operation_outputs"
        )
        expect(z.object({ steps: z.number() }).parse(rows[0]).steps).toBe(0)
    })
})
