import { asc, eq } from "drizzle-orm"
import { expect, test, vi } from "vitest"
import { type Access, problemsWith, roleOf } from "@/backend/auth/access"
import { makeApiToken } from "@/backend/auth/api-tokens"
import { ACCESS as APP_ACCESS } from "@/backend/auth/app"
import { type Infra, standInInfra } from "@/backend/infra"
import { queuedRuns } from "@/backend/workflows/tests/support/queued"
import { api_tokens, sessions, users } from "@/database/schema"
import { testDatabase } from "@/database/tests/support/database"
import { fromNow } from "@/database/time"
import { DAY } from "@/utilities/primitives/durations"
import { endConnectionsOfGone, syncTeam } from "../sync"

// What the server's start does with the list in backend/auth/app.ts:
// makes `users` the listed people, found by their slugs, and sets aside
// anyone the list doesn't have as they are, ending every way in they had

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
// Whoever's at the front desk: Sam, then Pat
const SAM = {
    slug: "front-desk",
    first_name: "Sam",
    last_name: "Smith",
    email: "sam@example.com"
}
const PAT = {
    slug: "front-desk",
    first_name: "Pat",
    last_name: "Jones",
    email: "pat@example.com"
}

function listing(...team: Access["team"]): Access {
    return { team, roles: APP_ACCESS.roles }
}

type TestDatabase = Awaited<ReturnType<typeof testDatabase>>

// The sync, with Infra's stand-in unless the test hands its own
async function sync(
    database: TestDatabase,
    access: Access,
    infra: Infra = standInInfra()
) {
    return await syncTeam(database, infra, access)
}

// An Infra that ends Claude's connections, with the calls it was asked
function endingInfra() {
    const infra = standInInfra()
    const ending = vi.spyOn(infra, "endAgentConnections")
    return { infra, ending }
}

// An Infra that doesn't answer when asked to end Claude's connections
function silentInfra() {
    const infra = standInInfra()
    vi.spyOn(infra, "endAgentConnections").mockResolvedValue({
        ok: false,
        error: { reason: "unavailable", message: "Infra didn't answer" }
    })
    vi.spyOn(console, "warn").mockImplementation(() => {})
    return infra
}

async function everyone(database: TestDatabase) {
    return await database
        .select({
            slug: users.slug,
            email: users.email,
            name: users.name,
            active: users.deactivated_at
        })
        .from(users)
        .orderBy(asc(users.slug))
        .then((rows) =>
            rows.map(({ active, ...row }) => ({
                ...row,
                active: active === null
            }))
        )
}

// The row with this slug
async function rowOf(database: TestDatabase, slug: string) {
    const [row] = await database
        .select()
        .from(users)
        .where(eq(users.slug, slug))
    if (row === undefined) {
        throw new Error(`No row has the slug ${slug}`)
    } else {
        return row
    }
}

// A session for this user, as logging in starts one
async function sessionFor(database: TestDatabase, user_id: string) {
    await database.insert(sessions).values({
        token_hash: crypto.randomUUID(),
        user_id,
        expires_at: fromNow(30 * DAY)
    })
}

// A session and an API token for this user
async function waysIn(database: TestDatabase, user_id: string) {
    await sessionFor(database, user_id)
    await makeApiToken(database, user_id, {
        name: "Nightly export",
        scopes: ["read", "act"],
        expires_in_days: null
    })
}

// Whose sessions and API tokens there are, by their rows' ids
async function holders(database: TestDatabase) {
    const session_rows = await database
        .select({ user_id: sessions.user_id })
        .from(sessions)
    const token_rows = await database
        .select({ user_id: api_tokens.user_id })
        .from(api_tokens)
    return {
        sessions: session_rows.map((row) => row.user_id).sort(),
        api_tokens: token_rows.map((row) => row.user_id).sort()
    }
}

test("this app's list has no mistakes", () => {
    expect(problemsWith(APP_ACCESS)).toEqual([])
})

test("this app's list has an owner, who may do everything", () => {
    expect(APP_ACCESS.team.some((listed) => roleOf(listed) === "owner")).toBe(
        true
    )
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

    expect(await sync(database, listing(ADA, GRACE))).toEqual({
        listed: 2,
        made: 2,
        deactivated: 1,
        waiting: 0
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
    expect(await sync(database, listing(ADA, GRACE))).toEqual({
        listed: 2,
        made: 0,
        deactivated: 0,
        waiting: 0
    })
})

test("someone made queues the notice to the rest of the team, once", async () => {
    const database = await testDatabase()
    await sync(database, listing(ADA))
    await sync(database, listing(ADA))
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

test("a new name changes the same row, and logs no one out", async () => {
    const database = await testDatabase()
    await sync(database, listing(ADA))
    const ada = await rowOf(database, "ada")
    await waysIn(database, ada.id)
    const { infra, ending } = endingInfra()

    await sync(database, listing({ ...ADA, last_name: "King" }), infra)
    expect(await rowOf(database, "ada")).toMatchObject({
        id: ada.id,
        name: "Ada King"
    })
    expect(await holders(database)).toEqual({
        sessions: [ada.id],
        api_tokens: [ada.id]
    })
    expect(ending).not.toHaveBeenCalled()
})

test("an entry edited in place keeps its row, under the new address, and ends every way in the old address had", async () => {
    const database = await testDatabase()
    await sync(database, listing(ADA, SAM))
    const ada = await rowOf(database, "ada")
    const sam = await rowOf(database, "front-desk")
    await waysIn(database, ada.id)
    await waysIn(database, sam.id)
    const { infra, ending } = endingInfra()

    expect(await sync(database, listing(ADA, PAT), infra)).toEqual({
        listed: 2,
        made: 0,
        deactivated: 0,
        waiting: 0
    })
    expect(await rowOf(database, "front-desk")).toMatchObject({
        id: sam.id,
        email: "pat@example.com",
        name: "Pat Jones",
        deactivated_at: null
    })
    // Sam's session and API token are gone, Ada's untouched, and Claude's
    // connections as the row were ended before it took the new address
    expect(await holders(database)).toEqual({
        sessions: [ada.id],
        api_tokens: [ada.id]
    })
    expect(ending).toHaveBeenCalledExactlyOnceWith(sam.id)
    expect(await queuedRuns(database)).toHaveLength(2)
})

test("a new slug listed with a departing person's address is someone new, in a row of their own", async () => {
    const database = await testDatabase()
    await sync(database, listing(ADA, SAM))
    const sam = await rowOf(database, "front-desk")
    await waysIn(database, sam.id)

    // Sam leaves, and Pat takes over the front desk's mailbox
    const pat = { ...PAT, slug: "pat", email: SAM.email }
    expect(await sync(database, listing(ADA, pat))).toEqual({
        listed: 2,
        made: 1,
        deactivated: 1,
        waiting: 0
    })
    expect(await everyone(database)).toEqual([
        expect.objectContaining({ slug: "ada", active: true }),
        expect.objectContaining({
            slug: "front-desk",
            email: "sam@example.com",
            name: "Sam Smith",
            active: false
        }),
        expect.objectContaining({
            slug: "pat",
            email: "sam@example.com",
            name: "Pat Jones",
            active: true
        })
    ])
    expect((await rowOf(database, "pat")).id).not.toBe(sam.id)
    expect(await holders(database)).toEqual({ sessions: [], api_tokens: [] })
})

test("a new slug listed with an address a deactivated row holds is someone new, and the old row stays as it was", async () => {
    const database = await testDatabase()
    await sync(database, listing(ADA, SAM))
    const sam = await rowOf(database, "front-desk")
    await sync(database, listing(ADA))

    await sync(
        database,
        listing(ADA, { ...PAT, slug: "pat", email: SAM.email })
    )
    expect(await rowOf(database, "front-desk")).toMatchObject({
        id: sam.id,
        name: "Sam Smith"
    })
    expect((await rowOf(database, "front-desk")).deactivated_at).not.toBeNull()
    expect(await rowOf(database, "pat")).toMatchObject({
        email: "sam@example.com",
        deactivated_at: null
    })
})

test("someone listed with an address a deactivated row holds takes it", async () => {
    const database = await testDatabase()
    await sync(database, listing(ADA, SAM))
    await sync(database, listing(ADA))

    expect(await sync(database, listing({ ...ADA, email: SAM.email }))).toEqual(
        { listed: 1, made: 0, deactivated: 0, waiting: 0 }
    )
    expect(await everyone(database)).toEqual([
        expect.objectContaining({
            slug: "ada",
            email: "sam@example.com",
            active: true
        }),
        expect.objectContaining({
            slug: "front-desk",
            email: "sam@example.com",
            active: false
        })
    ])
})

test("an address handed from one listed person to another moves, in either order of the list", async () => {
    const moved_ada = { ...ADA, email: "ada@lovelace.dev" }
    const moved_sam = { ...SAM, email: "ada@example.com" }
    for (const [before, after] of [
        [listing(ADA, SAM), listing(moved_ada, moved_sam)],
        [listing(SAM, ADA), listing(moved_sam, moved_ada)]
    ] as const) {
        const database = await testDatabase()
        await sync(database, before)
        expect(await sync(database, after)).toEqual({
            listed: 2,
            made: 0,
            deactivated: 0,
            waiting: 0
        })
        expect(await everyone(database)).toEqual([
            expect.objectContaining({
                slug: "ada",
                email: "ada@lovelace.dev",
                active: true
            }),
            expect.objectContaining({
                slug: "front-desk",
                email: "ada@example.com",
                active: true
            })
        ])
    }
})

test("two listed people who swap addresses each take the other's, logged out of both", async () => {
    const database = await testDatabase()
    await sync(database, listing(ADA, SAM))
    await waysIn(database, (await rowOf(database, "ada")).id)
    await waysIn(database, (await rowOf(database, "front-desk")).id)

    await sync(
        database,
        listing({ ...ADA, email: SAM.email }, { ...SAM, email: ADA.email })
    )
    expect(await everyone(database)).toEqual([
        expect.objectContaining({ email: "sam@example.com", active: true }),
        expect.objectContaining({ email: "ada@example.com", active: true })
    ])
    expect(await holders(database)).toEqual({ sessions: [], api_tokens: [] })
})

test("a row with a new address waits, set aside, while Infra doesn't end Claude's connections as it, and takes it once Infra does", async () => {
    const database = await testDatabase()
    await sync(database, listing(ADA, SAM))
    const sam = await rowOf(database, "front-desk")
    await waysIn(database, sam.id)

    expect(await sync(database, listing(ADA, PAT), silentInfra())).toEqual({
        listed: 2,
        made: 0,
        deactivated: 1,
        waiting: 1
    })
    expect(await rowOf(database, "front-desk")).toMatchObject({
        email: "sam@example.com"
    })
    expect((await rowOf(database, "front-desk")).deactivated_at).not.toBeNull()
    expect(await holders(database)).toEqual({ sessions: [], api_tokens: [] })

    expect(await sync(database, listing(ADA, PAT))).toEqual({
        listed: 2,
        made: 0,
        deactivated: 0,
        waiting: 0
    })
    expect(await rowOf(database, "front-desk")).toMatchObject({
        id: sam.id,
        email: "pat@example.com",
        deactivated_at: null
    })
})

test("taken off the list and listed again, someone is the same row, active again, once Infra has ended Claude's connections as them", async () => {
    const database = await testDatabase()
    await sync(database, listing(ADA, GRACE))
    const grace = await rowOf(database, "grace")

    await sync(database, listing(ADA))
    expect((await everyone(database))[1]).toMatchObject({ active: false })

    expect(await sync(database, listing(ADA, GRACE), silentInfra())).toEqual({
        listed: 2,
        made: 0,
        deactivated: 0,
        waiting: 1
    })
    expect((await rowOf(database, "grace")).deactivated_at).not.toBeNull()

    const { infra, ending } = endingInfra()
    await sync(database, listing(ADA, GRACE), infra)
    expect(ending).toHaveBeenCalledExactlyOnceWith(grace.id)
    const rows = await database.select().from(users)
    expect(rows).toHaveLength(2)
    expect(await rowOf(database, "grace")).toMatchObject({
        id: grace.id,
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
        await expect(sync(database, mistaken)).rejects.toThrow(
            /auth\/app\.ts's list has mistakes/
        )
    }
    expect(await database.select().from(users)).toEqual([])
})

test("with no one listed, everyone is deactivated", async () => {
    const database = await testDatabase()
    await sync(database, listing(ADA))
    expect(await sync(database, listing())).toEqual({
        listed: 0,
        made: 0,
        deactivated: 1,
        waiting: 0
    })
    expect(await everyone(database)).toMatchObject([{ active: false }])
})

test("taken off the list, someone's API tokens are revoked for good, so listing them again brings none back", async () => {
    const database = await testDatabase()
    await sync(database, listing(ADA, GRACE))
    const grace = await rowOf(database, "grace")
    await makeApiToken(database, grace.id, {
        name: "Nightly export",
        scopes: ["read"],
        expires_in_days: null
    })

    await sync(database, listing(ADA))
    await sync(database, listing(ADA, GRACE))
    expect(await database.select().from(api_tokens)).toEqual([])
})

test("Claude's connections as anyone deactivated are ended through Infra, and a refusal is logged, not thrown", async () => {
    const database = await testDatabase()
    await sync(database, listing(ADA, GRACE))
    await sync(database, listing(ADA))
    const grace = await rowOf(database, "grace")

    const infra = standInInfra()
    const ending = vi
        .spyOn(infra, "endAgentConnections")
        .mockResolvedValueOnce({ ok: true, data: 2 })
    expect(await endConnectionsOfGone(database, infra)).toBe(2)
    expect(ending).toHaveBeenCalledExactlyOnceWith(grace.id)

    const warned = vi.spyOn(console, "warn").mockImplementation(() => {})
    ending.mockResolvedValueOnce({
        ok: false,
        error: { reason: "unavailable", message: "Infra didn't answer" }
    })
    expect(await endConnectionsOfGone(database, infra)).toBe(0)
    expect(warned).toHaveBeenCalled()
})
