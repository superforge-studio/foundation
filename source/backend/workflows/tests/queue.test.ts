import { sql } from "drizzle-orm"
import { afterEach, beforeEach, expect, test } from "vitest"
import { z } from "zod"
import { tellTeamOfSignUp } from "@/backend/users/workflows"
import { users } from "@/database/schema"
import { Storage } from "@/database/storage"
import { testDatabase } from "@/database/tests/support/database"
import { memoryStore } from "@/database/tests/support/storage"
import { defineWorkflow } from "../define"
import { type WorkflowDependencies, workflowsProcess } from "../process"
import { connectionOf, queueEvent, queueWorkflow } from "../queue"
import { queuedRuns } from "./support/queued"

// Queueing runs inside a write's own transaction, on a database of the
// test's own, read back through DBOS's client: a run is queued if and only
// if its transaction commits, and an event queues each workflow on it,
// once. Nothing runs them, since the workflows aren't started here.

const welcome = defineWorkflow({
    name: "welcome",
    input: z.object({ user_id: z.uuid() }),
    run: async () => null
})

// Two more on the sign-up, one of them quiet, beside the template's notice
const syncSignUp = defineWorkflow({
    name: "sync-sign-up",
    input: z.object({ user_id: z.uuid() }),
    on: ["user-signed-up"],
    quiet: true,
    run: async () => null
})
const neverListed = defineWorkflow({
    name: "never-listed",
    input: z.object({ user_id: z.uuid() }),
    run: async () => null
})

// The workflows this process knows, while each test runs: the test's, as a
// started process's are
beforeEach(async () => {
    const dependencies: WorkflowDependencies = {
        database: await testDatabase(),
        storage: new Storage(memoryStore().store),
        database_url: "postgres://unused",
        workflows: [tellTeamOfSignUp, welcome, syncSignUp]
    }
    workflowsProcess().dependencies = dependencies
})
afterEach(() => {
    workflowsProcess().dependencies = null
})

test("a run is queued with its transaction, and not when it rolls back", async () => {
    const database = await testDatabase()
    const user_id = crypto.randomUUID()

    await database.transaction(async (transaction) => {
        await transaction
            .insert(users)
            .values({ id: user_id, email: "ada@example.com" })
        await queueWorkflow(
            transaction,
            welcome,
            { user_id },
            { id: `welcome-${user_id}` }
        )
    })

    // The write and its run, together, and nothing of either when the
    // transaction fails after both
    await expect(
        database.transaction(async (transaction) => {
            await transaction
                .insert(users)
                .values({ email: "grace@example.com" })
            await queueWorkflow(transaction, welcome, {
                user_id: crypto.randomUUID()
            })
            throw new Error("Something after them failed")
        })
    ).rejects.toThrow("Something after them failed")

    expect(await database.select({ email: users.email }).from(users)).toEqual([
        { email: "ada@example.com" }
    ])
    expect(await queuedRuns(database)).toEqual([
        {
            workflow: "welcome",
            id: `welcome-${user_id}`,
            input: { user_id },
            queue: "background"
        }
    ])
})

test("handed the pool, it queues in a transaction of its own; queued again by its id, it's the same run", async () => {
    const database = await testDatabase()
    const user_id = crypto.randomUUID()
    const first = await queueWorkflow(
        database,
        welcome,
        { user_id },
        { id: `welcome-${user_id}` }
    )
    const again = await queueWorkflow(
        database,
        welcome,
        { user_id },
        { id: `welcome-${user_id}` }
    )
    expect(again).toBe(first)
    expect(await queuedRuns(database)).toHaveLength(1)
})

test("input that doesn't fit, or a workflow nothing runs, throws and rolls the write back", async () => {
    const database = await testDatabase()
    await expect(
        database.transaction(async (transaction) => {
            await transaction.insert(users).values({ email: "ada@example.com" })
            await queueWorkflow(transaction, welcome, { user_id: "not-a-uuid" })
        })
    ).rejects.toThrow()
    await expect(
        queueWorkflow(database, neverListed, { user_id: crypto.randomUUID() })
    ).rejects.toThrow("The never-listed workflow isn't in WORKFLOWS")

    expect(await database.select().from(users)).toEqual([])
    expect(await queuedRuns(database)).toEqual([])
})

test("an event queues each workflow on it, named for the event, once", async () => {
    const database = await testDatabase()
    const user_id = crypto.randomUUID()
    const event = { user_id, email: "ada@example.com" }

    const queued = await queueEvent(database, "user-signed-up", event, {
        id: user_id
    })
    expect(queued).toEqual([
        `tell-team-of-sign-up-${user_id}`,
        `sync-sign-up-${user_id}`
    ])
    // The same event again finds the runs already there
    await queueEvent(database, "user-signed-up", event, { id: user_id })

    // Each with the event's data, as far as its input takes it
    const runs = await queuedRuns(database)
    expect(runs.map((run) => [run.workflow, run.input])).toEqual([
        ["tell-team-of-sign-up", event],
        ["sync-sign-up", { user_id }]
    ])
})

test("an event no workflow is on writes nothing", async () => {
    const database = await testDatabase()
    const known = workflowsProcess().dependencies
    if (known !== null) {
        workflowsProcess().dependencies = { ...known, workflows: [welcome] }
    }
    expect(
        await queueEvent(database, "user-signed-up", {
            user_id: crypto.randomUUID(),
            email: "ada@example.com"
        })
    ).toEqual([])
    expect(await queuedRuns(database)).toEqual([])
})

test("a transaction's connection is where queueing looks for it", async () => {
    const database = await testDatabase()
    await database.transaction(async (transaction) => {
        const connection = connectionOf(transaction)
        // The same connection the transaction's own queries run on
        const [mine] = (await connection.query("select txid_current() as id"))
            .rows
        const [its] = (
            await transaction.execute(sql`select txid_current() as id`)
        ).rows
        expect(mine).toEqual(its)
    })
    expect(() => connectionOf({})).toThrow(
        "A Drizzle transaction's pg client wasn't where it was"
    )
})
