import { createHash } from "node:crypto"
import { and, eq, inArray, isNotNull } from "drizzle-orm"
import { ACCESS, listedRole, nameOf } from "@/backend/auth/access"
import type { Database } from "@/database"
import { api_tokens, sessions, users } from "@/database/schema"
import { fromNow } from "@/database/time"
import { DAY, HOUR, MINUTE } from "@/utilities/primitives/durations"
import type { Seeder } from "./seed"

// Sample users, their sessions and their API tokens: the business's own
// people, as backend/auth/access.ts lists them, the first logged in now,
// with three tokens, and the second with a session that has run out, and
// customers who've signed up over the last few days, one with no name and
// one added by hand who's never logged in. The customers' addresses are
// example.com's, which reach nobody.

// The business's own, made from the list, so the seed's internal people
// are the ones the code says, and the server's start changes none of them
const INTERNAL = ACCESS.internal_users.map((person, index) => ({
    email: person.email.trim().toLowerCase(),
    name: nameOf(person),
    role: listedRole(person),
    logged_in_at: fromNow(-(2 + 43 * index) * DAY),
    created_at: fromNow(-(94 - 3 * index) * DAY)
}))

// The first two of them, whose sample sessions follow
const [FIRST_INTERNAL, SECOND_INTERNAL] = INTERNAL

const SAMPLE_USERS = [
    ...INTERNAL,
    {
        email: "maria.santos@example.com",
        name: "Maria Santos",
        role: "external" as const,
        logged_in_at: fromNow(-2 * HOUR),
        created_at: fromNow(-2 * HOUR)
    },
    {
        email: "jun.park@example.com",
        name: "Jun Park",
        role: "external" as const,
        logged_in_at: fromNow(-5 * HOUR),
        created_at: fromNow(-19 * HOUR)
    },
    {
        email: "olu.adeyemi@example.com",
        name: null,
        role: "external" as const,
        logged_in_at: fromNow(-26 * HOUR),
        created_at: fromNow(-26 * HOUR)
    },
    {
        email: "linus@example.com",
        name: null,
        role: "external" as const,
        logged_in_at: null,
        created_at: fromNow(-40 * DAY)
    }
]

// What the browsers said of themselves
const CHROME_ON_A_MAC =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
const SAFARI_ON_AN_IPHONE =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1"

// Each session by its user, with the token its cookie would hold: its
// SHA-256 is what's kept, as a real session's is (backend/auth/tokens.ts)
const SAMPLE_SESSIONS = [
    ...(FIRST_INTERNAL === undefined
        ? []
        : [
              {
                  email: FIRST_INTERNAL.email,
                  token: "sample-session-internal",
                  user_agent: CHROME_ON_A_MAC,
                  created_at: fromNow(-12 * DAY),
                  expires_at: fromNow(28 * DAY)
              },
              {
                  email: FIRST_INTERNAL.email,
                  token: "sample-session-internal-phone",
                  user_agent: SAFARI_ON_AN_IPHONE,
                  created_at: fromNow(-31 * DAY),
                  expires_at: fromNow(20 * DAY)
              }
          ]),
    ...(SECOND_INTERNAL === undefined
        ? []
        : [
              {
                  email: SECOND_INTERNAL.email,
                  token: "sample-session-internal-expired",
                  user_agent: null,
                  created_at: fromNow(-60 * DAY),
                  expires_at: fromNow(-15 * DAY)
              }
          ]),
    {
        email: "maria.santos@example.com",
        token: "sample-session-maria",
        user_agent: SAFARI_ON_AN_IPHONE,
        created_at: fromNow(-2 * HOUR),
        expires_at: fromNow(30 * DAY - 2 * HOUR)
    }
]

/** The sample users, in place of every user there was. */
export const seedUsers: Seeder = async (transaction: Database) => {
    await transaction.delete(users)
    const rows = await transaction
        .insert(users)
        .values(SAMPLE_USERS)
        .returning({ id: users.id })
    return { table: "users", rows: rows.length }
}

/**
 * The customers who signed up themselves, whose sign-ups each start the
 * workflow that tells the team (backend/users/workflows.ts): what the seed
 * starts real runs of, rather than writing DBOS's rows.
 */
export async function signedUp(database: Database) {
    const rows = await database
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(and(eq(users.role, "external"), isNotNull(users.logged_in_at)))
    return rows
}

/** Their sessions, in place of every session there was. */
export const seedSessions: Seeder = async (transaction: Database) => {
    await transaction.delete(sessions)
    const owners = await transaction
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(
            inArray(
                users.email,
                SAMPLE_SESSIONS.map((session) => session.email)
            )
        )
    const values = SAMPLE_SESSIONS.map((session) => {
        const owner = owners.find((user) => user.email === session.email)
        if (owner === undefined) {
            throw new Error("A sample session's user wasn't seeded")
        }
        return {
            token_hash: createHash("sha256")
                .update(session.token)
                .digest("hex"),
            user_id: owner.id,
            user_agent: session.user_agent,
            created_at: session.created_at,
            expires_at: session.expires_at
        }
    })
    const rows = await transaction
        .insert(sessions)
        .values(values)
        .returning({ token_hash: sessions.token_hash })
    return { table: "auth.sessions", rows: rows.length }
}

// The first internal person's API tokens, one in each state the account
// page shows: in use, never used and running out, and run out. Each is kept
// by its SHA-256, as a real one is, of a token too short to be one, so no
// script logs in with them (backend/auth/api-tokens.ts)
const SAMPLE_API_TOKENS = [
    {
        name: "Nightly export",
        token: "sample-api-token-nightly-export-Q7x2",
        scopes: ["read" as const],
        expires_at: null,
        last_used_at: fromNow(-3 * HOUR - 12 * MINUTE),
        created_at: fromNow(-41 * DAY)
    },
    {
        name: "Zapier",
        token: "sample-api-token-zapier-mR4k",
        scopes: ["read" as const, "act" as const],
        expires_at: fromNow(83 * DAY),
        last_used_at: null,
        created_at: fromNow(-7 * DAY)
    },
    {
        name: "Old import script",
        token: "sample-api-token-old-import-b9Td",
        scopes: ["read" as const, "act" as const],
        expires_at: fromNow(-5 * DAY),
        last_used_at: fromNow(-36 * DAY),
        created_at: fromNow(-95 * DAY)
    }
]

/** The first internal person's API tokens, in place of every token there was. */
export const seedApiTokens: Seeder = async (transaction: Database) => {
    await transaction.delete(api_tokens)
    if (FIRST_INTERNAL === undefined) {
        return { table: "auth.api_tokens", rows: 0 }
    }
    const [owner] = await transaction
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, FIRST_INTERNAL.email))
    if (owner === undefined) {
        throw new Error("The sample tokens' user wasn't seeded")
    }
    const rows = await transaction
        .insert(api_tokens)
        .values(
            SAMPLE_API_TOKENS.map(({ token, ...sample }) => ({
                ...sample,
                user_id: owner.id,
                token_hash: createHash("sha256").update(token).digest("hex"),
                preview: token.slice(-4)
            }))
        )
        .returning({ id: api_tokens.id })
    return { table: "auth.api_tokens", rows: rows.length }
}
