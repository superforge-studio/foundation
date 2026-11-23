import { asc, eq } from "drizzle-orm"
import { expect, test, vi } from "vitest"
import {
    type Access,
    ACCESS as APP_ACCESS,
    problemsWith,
    roleOf
} from "@/backend/auth/access"
import { makeApiToken } from "@/backend/auth/api-tokens"
import { standInInfra } from "@/backend/infra"
import { queuedRuns } from "@/backend/workflows/tests/support/queued"
import { api_tokens, sessions, users } from "@/database/schema"
import { testDatabase } from "@/database/tests/support/database"
import { fromNow } from "@/database/time"
import { DAY } from "@/utilities/primitives/durations"
import { endConnectionsOfGone, syncInternalUsers } from "../sync"

// What the server's start does with the list in backend/auth/access.ts:
// makes `users` the listed people, found by their slugs, and deactivates
// anyone else, ending their sessions

const ADA = {
    slug: "ada",
    first_name: "Ada",
    last_name: "Lovelace",
    email: "Ada@Example.com"
}
const GRACE = {
    slug: "grace",
    first_name: "Grace",
    last_name: "Hopper",
    email: "grace@example.com"
}

function listing(...internal_users: Access["internal_users"]): Access {
    return { internal_users, roles: APP_ACCESS.roles }
}

type TestDatabase = Awaited<ReturnType<typeof testDatabase>>

async function everyone(database: TestDatabase) {
    return await database
        .select({
            slug: users.slug,
            email: users.email,
            name: users.name,
            active: users.deactivated_at
        })
        .from(users)
        .orderBy(asc(users.email))
        .then((rows) =>
            rows.map(({ active, ...row }) => ({
                ...row,
                active: active === null
            }))
        )
}

// A session for this user, as logging in starts one
async function sessionFor(database: TestDatabase, user_id: string) {
    await database.insert(sessions).values({
        token_hash: crypto.randomUUID(),
        user_id,
        expires_at: fromNow(30 * DAY)
    })
}

test("this app's list has no mistakes", () => {
    expect(problemsWith(APP_ACCESS)).toEqual([])
})

test("this app's list has an owner, who may do everything", () => {
    expect(
        APP_ACCESS.internal_users.some((listed) => roleOf(listed) === "owner")
    ).toBe(true)
    expect(APP_ACCESS.roles.owner).toBe("everything")
})

test("makes each listed person, as listed, and deactivates anyone else, ending their sessions", async () => {
    const database = await testDatabase()
    const [linus] = await database
        .insert(users)
        .values({ slug: "linus", email: "linus@example.com", name: "Linus" })
        .returning({ id: users.id })
    if (linus === undefined) {
        throw new Error("Linus wasn't made")
    }
    await sessionFor(database, linus.id)

    expect(await syncInternalUsers(database, listing(ADA, GRACE))).toEqual({
        listed: 2,
        made: 2,
        deactivated: 1
    })
    expect(await everyone(database)).toEqual([
        {
            slug: "ada",
            email: "ada@example.com",
            name: "Ada Lovelace",
            active: true
        },
        {
            slug: "grace",
            email: "grace@example.com",
            name: "Grace Hopper",
            active: true
        },
        {
            slug: "linus",
            email: "linus@example.com",
            name: "Linus",
            active: false
        }
    ])
    expect(await database.select().from(sessions)).toEqual([])

    // Again, with nothing to change
    expect(await syncInternalUsers(database, listing(ADA, GRACE))).toEqual({
        listed: 2,
        made: 0,
        deactivated: 0
    })
})

test("someone made queues the notice to the rest of the team, once", async () => {
    const database = await testDatabase()
    await syncInternalUsers(database, listing(ADA))
    await syncInternalUsers(database, listing(ADA))
    const [ada] = await database.select({ id: users.id }).from(users)
    expect(await queuedRuns(database)).toEqual([
        {
            workflow: "tell-team-of-new-member",
            input: { user_id: ada?.id, email: "ada@example.com" },
            id: `tell-team-of-new-member-${ada?.id}`,
            queue: "background"
        }
    ])
})

test("a row from before slugs is found by its address, and takes the slug it's listed with, with no notice", async () => {
    const database = await testDatabase()
    const [old] = await database
        .insert(users)
        .values({
            slug: "3f2a9c1e-4b5d-4e6f-8a7b-9c0d1e2f3a4b",
            email: "ada@example.com"
        })
        .returning({ id: users.id })
    await syncInternalUsers(database, listing(ADA))
    const [row] = await database.select().from(users)
    expect(row).toMatchObject({ id: old?.id, slug: "ada" })
    expect(await queuedRuns(database)).toEqual([])
})

test("a new address changes the same row, found by its slug", async () => {
    const database = await testDatabase()
    await syncInternalUsers(database, listing(ADA))
    const [before] = await database.select({ id: users.id }).from(users)
    await syncInternalUsers(
        database,
        listing({ ...ADA, email: "ada@lovelace.dev" })
    )
    expect(await database.select().from(users)).toEqual([
        expect.objectContaining({ id: before?.id, email: "ada@lovelace.dev" })
    ])
})

test("taken off the list and listed again, someone is the same row, active again", async () => {
    const database = await testDatabase()
    await syncInternalUsers(database, listing(ADA, GRACE))
    const [grace] = await database
        .select({ id: users.id })
        .from(users)
        .where(eq(users.slug, "grace"))

    await syncInternalUsers(database, listing(ADA))
    expect((await everyone(database))[1]).toMatchObject({ active: false })

    await syncInternalUsers(database, listing(ADA, GRACE))
    const rows = await database.select().from(users)
    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.slug === "grace")).toMatchObject({
        id: grace?.id,
        deactivated_at: null
    })
})

test("a list with a mistake in it changes nothing", async () => {
    const database = await testDatabase()
    for (const mistaken of [
        listing(ADA, { ...GRACE, slug: "ada" }),
        listing(ADA, { ...GRACE, email: "ada@example.com" }),
        listing({ ...ADA, slug: "Ada Lovelace" })
    ]) {
        await expect(syncInternalUsers(database, mistaken)).rejects.toThrow(
            /access.ts's list has mistakes/
        )
    }
    expect(await database.select().from(users)).toEqual([])
})

test("with no one listed, everyone is deactivated", async () => {
    const database = await testDatabase()
    await syncInternalUsers(database, listing(ADA))
    expect(await syncInternalUsers(database, listing())).toEqual({
        listed: 0,
        made: 0,
        deactivated: 1
    })
    expect(await everyone(database)).toMatchObject([{ active: false }])
})

test("taken off the list, someone's API tokens are revoked for good, so listing them again brings none back", async () => {
    const database = await testDatabase()
    await syncInternalUsers(database, listing(ADA, GRACE))
    const [grace] = await database
        .select({ id: users.id })
        .from(users)
        .where(eq(users.slug, "grace"))
    if (grace === undefined) {
        throw new Error("Grace wasn't made")
    }
    await makeApiToken(database, grace.id, {
        name: "Nightly export",
        scopes: ["read"],
        expires_in_days: null
    })

    await syncInternalUsers(database, listing(ADA))
    await syncInternalUsers(database, listing(ADA, GRACE))
    expect(await database.select().from(api_tokens)).toEqual([])
})

test("Claude's connections as anyone deactivated are ended through Infra, and a refusal is logged, not thrown", async () => {
    const database = await testDatabase()
    await syncInternalUsers(database, listing(ADA, GRACE))
    await syncInternalUsers(database, listing(ADA))
    const [grace] = await database
        .select({ id: users.id })
        .from(users)
        .where(eq(users.slug, "grace"))

    const infra = standInInfra()
    const ending = vi
        .spyOn(infra, "endAgentConnections")
        .mockResolvedValueOnce({ ok: true, data: 2 })
    expect(await endConnectionsOfGone(database, infra)).toBe(2)
    expect(ending).toHaveBeenCalledExactlyOnceWith(grace?.id)

    const warned = vi.spyOn(console, "warn").mockImplementation(() => {})
    ending.mockResolvedValueOnce({
        ok: false,
        error: { reason: "unavailable", message: "Infra didn't answer" }
    })
    expect(await endConnectionsOfGone(database, infra)).toBe(0)
    expect(warned).toHaveBeenCalled()
})
