import { eq } from "drizzle-orm"
import { summarizeVisits } from "@/backend/visits/summarize"
import type { Database } from "@/database"
import { analytics_events, analytics_visits, users } from "@/database/schema"
import { DAY, HOUR, MINUTE } from "@/utilities/primitives/durations"
import type { Seeder } from "./seed"

// Sample visits and their events, as the pages' script and the server
// would have recorded them (backend/visits/): a customer who came from an
// ad, looked around and signed up; a visitor the site didn't remember,
// who bounced; one whose page ran into an error; and one who came back
// from a newsletter and booked. The remembered ones' addresses are set
// aside for documentation (RFC 5737 and RFC 3849). Each visit is worked out from its events,
// as a real one is, so the two always agree.

// The sample customer whose visit ends in their sign-up (./users.ts)
const SIGNED_UP = "maria.santos@example.com"

// How long ago each visit started, with its ID, written out so its events
// can name it
const FROM_AN_AD = {
    id: "5b0c1f0e-6c1d-4f6a-9a53-1f2e3d4c5b6a",
    ago: 2 * HOUR + 12 * MINUTE
}
const BOUNCED = {
    id: "8a7d6c5b-4e3f-4a2b-8c1d-0e9f8a7b6c5d",
    ago: 26 * HOUR
}
const HIT_AN_ERROR = {
    id: "c3d2e1f0-9a8b-4c7d-b6e5-f4a3b2c1d0e9",
    ago: 3 * DAY
}
const CAME_BACK = {
    id: "e9f8a7b6-c5d4-4e3f-a2b1-c0d9e8f7a6b5",
    ago: 5 * DAY
}

// Who each visit's visitor was: a remembered one's lasting ID, or the day's
// hash of one who wasn't
const VISITORS = {
    maria: "2f1c8e64-7b5a-4f2e-9c3d-8a6b1e0f4d27",
    anonymous: "Yx3kq9ZrT1mWb7uVc2NdLg",
    priya: "9d0c2c1e-55a1-4c1a-8f0e-0a7d5f1b2c3d",
    tomas: "41c7a3e2-0b9d-4d58-a6f1-7e2c9b8d3a10"
}

// The moment `after` into a visit that started `ago` ago
function during(visit: { ago: number }, after: number) {
    return new Date(Date.now() - visit.ago + after)
}

// The sample customer who signed up, once the users are seeded
async function signedUpUser(transaction: Database) {
    const [user] = await transaction
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, SIGNED_UP))
    return user?.id ?? null
}

/** The sample visits, in place of every visit there was, and its events. */
export const seedAnalyticsVisits: Seeder = async (transaction: Database) => {
    await transaction.delete(analytics_visits)
    const signed_up = await signedUpUser(transaction)

    const rows = await transaction
        .insert(analytics_visits)
        .values([
            {
                id: FROM_AN_AD.id,
                visitor_id: VISITORS.maria,
                anonymous: false,
                user_id: signed_up,
                started_at: during(FROM_AN_AD, 0),
                ended_at: during(FROM_AN_AD, 0),
                ip_address: "203.0.113.42",
                country: "US",
                device: "mobile",
                browser: "Safari",
                os: "iOS"
            },
            {
                id: BOUNCED.id,
                visitor_id: VISITORS.anonymous,
                anonymous: true,
                started_at: during(BOUNCED, 0),
                ended_at: during(BOUNCED, 0),
                country: "DE",
                device: "desktop",
                browser: "Firefox",
                os: "Windows"
            },
            {
                id: HIT_AN_ERROR.id,
                visitor_id: VISITORS.priya,
                anonymous: false,
                started_at: during(HIT_AN_ERROR, 0),
                ended_at: during(HIT_AN_ERROR, 0),
                ip_address: "198.51.100.23",
                country: "GB",
                device: "tablet",
                browser: "Safari",
                os: "iOS"
            },
            {
                // A visitor the server couldn't place
                id: CAME_BACK.id,
                visitor_id: VISITORS.tomas,
                anonymous: false,
                started_at: during(CAME_BACK, 0),
                ended_at: during(CAME_BACK, 0),
                ip_address: "2001:db8:85a3::8a2e:370:7334",
                country: null,
                device: "desktop",
                browser: "Chrome",
                os: "macOS"
            }
        ])
        .returning({ id: analytics_visits.id })
    return { table: "analytics_visits", rows: rows.length }
}

/**
 * Their events, and the server's own, in place of every event there was,
 * with each visit then worked out from its own.
 */
export const seedAnalyticsEvents: Seeder = async (transaction: Database) => {
    await transaction.delete(analytics_events)
    const signed_up = await signedUpUser(transaction)

    const maria = {
        source: "browser" as const,
        visit_id: FROM_AN_AD.id,
        visitor_id: VISITORS.maria
    }
    const anonymous = {
        source: "browser" as const,
        visit_id: BOUNCED.id,
        visitor_id: VISITORS.anonymous
    }
    const priya = {
        source: "browser" as const,
        visit_id: HIT_AN_ERROR.id,
        visitor_id: VISITORS.priya
    }
    const tomas = {
        source: "browser" as const,
        visit_id: CAME_BACK.id,
        visitor_id: VISITORS.tomas
    }

    const rows = await transaction
        .insert(analytics_events)
        .values([
            // From a Google ad, through three pages, to signing up
            {
                ...maria,
                name: "view",
                path: "/",
                properties: {
                    title: "Home",
                    referrer: "google.com",
                    utm_source: "google",
                    utm_medium: "cpc",
                    utm_campaign: "spring",
                    gclid: "sample-click",
                    screen: "390x844",
                    language: "en-US"
                },
                occurred_at: during(FROM_AN_AD, 0)
            },
            {
                ...maria,
                name: "click",
                path: "/",
                properties: {
                    target: "login",
                    text: "Log in",
                    href: "/login"
                },
                occurred_at: during(FROM_AN_AD, 40_000)
            },
            {
                ...maria,
                name: "leave",
                path: "/",
                properties: { scroll: 85, visible_ms: 41_000 },
                occurred_at: during(FROM_AN_AD, 41_000)
            },
            {
                ...maria,
                name: "view",
                path: "/login",
                properties: { title: "Log in" },
                occurred_at: during(FROM_AN_AD, 41_000)
            },
            {
                source: "server",
                name: "signed-up",
                visitor_id: VISITORS.maria,
                user_id: signed_up,
                occurred_at: during(FROM_AN_AD, 12 * MINUTE)
            },
            {
                ...maria,
                user_id: signed_up,
                name: "view",
                path: "/dashboard/account",
                properties: { title: "Account" },
                occurred_at: during(FROM_AN_AD, 12 * MINUTE + 2000)
            },

            // One page, from another site, and gone
            {
                ...anonymous,
                name: "view",
                path: "/",
                properties: { title: "Home", referrer: "news.ycombinator.com" },
                occurred_at: during(BOUNCED, 0)
            },
            {
                ...anonymous,
                name: "leave",
                path: "/",
                properties: { scroll: 20, visible_ms: 6000 },
                occurred_at: during(BOUNCED, 6000)
            },

            // A page that threw
            {
                ...priya,
                name: "view",
                path: "/",
                properties: { title: "Home" },
                occurred_at: during(HIT_AN_ERROR, 0)
            },
            {
                ...priya,
                name: "error",
                path: "/",
                properties: {
                    message: "Cannot read properties of undefined",
                    source: "/assets/index.js",
                    line: 1,
                    column: 20_481
                },
                occurred_at: during(HIT_AN_ERROR, 3000)
            },

            // Back from a newsletter, to book a call
            {
                ...tomas,
                name: "view",
                path: "/",
                properties: {
                    title: "Home",
                    utm_source: "newsletter",
                    utm_medium: "email",
                    utm_campaign: "november"
                },
                occurred_at: during(CAME_BACK, 0)
            },
            {
                ...tomas,
                name: "click",
                path: "/",
                properties: {
                    target: "book-a-call",
                    text: "Book a call",
                    href: "/book"
                },
                occurred_at: during(CAME_BACK, 25_000)
            },
            {
                ...tomas,
                name: "booked-a-call",
                path: "/",
                properties: { plan: "monthly" },
                occurred_at: during(CAME_BACK, 90_000)
            }
        ])
        .returning({ id: analytics_events.id })

    await summarizeVisits(transaction, [
        FROM_AN_AD.id,
        BOUNCED.id,
        HIT_AN_ERROR.id,
        CAME_BACK.id
    ])
    return { table: "analytics_events", rows: rows.length }
}
