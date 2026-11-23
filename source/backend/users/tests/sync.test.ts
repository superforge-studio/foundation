import { asc } from "drizzle-orm"
import { expect, test } from "vitest"
import { users } from "@/database/schema"
import { testDatabase } from "@/database/tests/support/database"
import { syncInternalUsers } from "../sync"

// What the server's start does with the list in backend/auth/access.ts:
// makes the database's internal users the listed ones, and no one else

const ACCESS = {
    login: "anyone" as const,
    internal_users: [
        { first_name: "Ada", last_name: "Lovelace", email: "Ada@Example.com" },
        {
            first_name: "Grace",
            last_name: "Hopper",
            email: "grace@example.com"
        },
        // Listed twice: the first listing wins
        { first_name: "Ada", last_name: "Again", email: "ada@example.com" }
    ]
}

async function everyone(database: Awaited<ReturnType<typeof testDatabase>>) {
    return await database
        .select({ email: users.email, name: users.name, role: users.role })
        .from(users)
        .orderBy(asc(users.email))
}

test("makes each listed person, names them as listed, and makes anyone else external", async () => {
    const database = await testDatabase()
    await database.insert(users).values([
        // Logged in before, as a customer, then listed
        { email: "grace@example.com", name: "G", role: "external" },
        // Internal, but not listed
        { email: "linus@example.com", name: "Linus", role: "internal" },
        { email: "maria@example.com", name: "Maria", role: "external" }
    ])

    expect(await syncInternalUsers(database, ACCESS)).toEqual({
        listed: 2,
        made: 1,
        made_external: 1
    })
    expect(await everyone(database)).toEqual([
        { email: "ada@example.com", name: "Ada Lovelace", role: "internal" },
        { email: "grace@example.com", name: "Grace Hopper", role: "internal" },
        { email: "linus@example.com", name: "Linus", role: "external" },
        { email: "maria@example.com", name: "Maria", role: "external" }
    ])

    // Again, with nothing to change
    expect(await syncInternalUsers(database, ACCESS)).toEqual({
        listed: 2,
        made: 0,
        made_external: 0
    })
})

test("with no one listed, no one is internal", async () => {
    const database = await testDatabase()
    await database
        .insert(users)
        .values([{ email: "ada@example.com", role: "internal" }])
    expect(
        await syncInternalUsers(database, {
            login: "anyone",
            internal_users: []
        })
    ).toEqual({ listed: 0, made: 0, made_external: 1 })
    expect(await everyone(database)).toMatchObject([{ role: "external" }])
})
