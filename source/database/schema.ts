// Drizzle table definitions (Postgres). This file is the source of truth for
// the schema: change it, run `pnpm database:generate`, and commit the
// migration with it (workbench/writing-code.md, "Data"). A table of the
// business's own starts like `users`, below:
//
//   export const customers = pgTable("customers", {
//       id: id(),
//       name: text().notNull(),
//       created_at: timestamp().notNull().defaultNow()
//   })
//
// The conventions:
// - A table is named for what it hangs off (`customer_*` for what belongs
//   to a customer), or for the area it's part of when it hangs off nothing
//   (`analytics_*`), in the plural, with snake_case columns, which Drizzle
//   keeps as written. A plain word like `visits` or `events` is left for
//   the business's own.
// - A single value the server keeps for itself, like a day's salt, is a
//   file in the Storage bucket (storage/files.ts), not a table of one row.
// - Our own rows are keyed by a uuid (`id()` in columns.ts), or by what
//   makes them unique when that's natural.
// - Every timestamp is a `timestamptz` to the millisecond (`timestamp()`),
//   compared against `now` and `fromNow` from time.ts.
// - Every table gets sample rows in seed/seed.ts in the same change, or a
//   line in its UNSEEDED saying why not, which seed/tests/ checks.
// - A table goes in one of four Postgres schemas, by who owns its rows and
//   who sees them, never one per feature (features are folders in code):
//   - `public`: the business's own data, whatever the app is built to do,
//     its users among it: they're its customers and staff, whom its other
//     tables point at. A table here is `pgTable(...)`.
//   - `auth`: what lets someone in: their sessions and their API tokens.
//     The most sensitive rows, since one is as good as a password, kept
//     apart so a read-only role can leave them out. A table here is
//     `auth.table(...)`. The login codes aren't here: Infra keeps them.
//   - `internal`: the rest of the machinery, what no person sees, like an
//     error log or rate limits. A table here is `internal.table(...)`.
//   - `dbos`: DBOS's own tables, the workflows' runs and their steps
//     (backend/workflows/), which it makes and migrates itself. Nothing
//     here writes to it, and it isn't declared below.
import { sql } from "drizzle-orm"
import {
    boolean,
    check,
    index,
    inet,
    integer,
    jsonb,
    pgSchema,
    pgTable,
    text,
    uuid
} from "drizzle-orm/pg-core"
// Relative, since drizzle-kit reads this file without the app's `@/` paths
import { AGENT_SCOPES } from "../utilities/schemas/agents"
import { ROLES } from "../utilities/schemas/users"
import { DEVICES, EVENT_SOURCES } from "../utilities/visitors"
import { WEBHOOK_OUTCOMES } from "../utilities/webhooks"
import { id, timestamp } from "./columns"

export const auth = pgSchema("auth")
export const internal = pgSchema("internal")

// The business's own people and everyone it serves, everyone who can log
// in: logging in for the first time makes the row (backend/auth/login.ts),
// unless an internal person added them first (backend/users/). Infra proves
// the address is theirs, and keeps nothing of them.
export const users = pgTable(
    "users",
    {
        id: id(),
        // Trimmed and lowercased as it comes in, so the unique constraint
        // catches case variants
        email: text().notNull().unique(),
        // What they'd like to be called, which they set on their account
        name: text(),
        // Who they are to the business, which decides what of the dashboard
        // they see (utilities/schemas/users.ts has the roles): text with a
        // check rather than a Postgres enum, since a role added to an enum
        // can't be used in the transaction that adds it, and a deploy
        // applies every pending migration in one
        role: text({ enum: ROLES }).notNull().default("external"),
        // When they last logged in, or null for someone who never has, like
        // a user added by hand before they do
        logged_in_at: timestamp(),
        created_at: timestamp().notNull().defaultNow()
    },
    (table) => [
        check(
            "users_role_check",
            sql.raw(
                `"${table.role.name}" in (${ROLES.map((role) => `'${role}'`).join(", ")})`
            )
        )
    ]
)

// A browser's login, which its `session` cookie holds the token for
// (backend/auth/sessions.ts). Only the token's SHA-256 is kept. It lasts 30
// days from when it was last renewed, and logging out deletes it.
export const sessions = auth.table(
    "sessions",
    {
        token_hash: text().primaryKey(),
        user_id: uuid()
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        // The browser it's in, as it said (its User-Agent), so the account
        // page can say where someone is logged in
        user_agent: text(),
        expires_at: timestamp().notNull(),
        created_at: timestamp().notNull().defaultNow()
    },
    (table) => [index("sessions_user_id_index").on(table.user_id)]
)

// A token one of the business's own people made on their account page, for
// what can't log in through a browser, like a script, a scheduled job or
// another platform's agent: it calls the API as them, with what they let it
// do, until they revoke it, which deletes the row, or it runs out
// (backend/auth/api-tokens.ts). Only the token's SHA-256 is kept.
export const api_tokens = auth.table(
    "api_tokens",
    {
        id: id(),
        user_id: uuid()
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        // What they called it, so they know which script holds it
        name: text().notNull(),
        token_hash: text().notNull().unique(),
        // The token's last characters, shown beside its name, so a token in
        // a script can be matched to its row
        preview: text().notNull(),
        // What it may do (`AGENT_SCOPES`, utilities/schemas/agents.ts), as
        // Claude's tokens may: `read`, the API's `GET` routes, and `act`,
        // everything else its person could do themselves
        scopes: text({ enum: AGENT_SCOPES }).array().notNull(),
        // When it runs out, or null for a token that lasts until it's revoked
        expires_at: timestamp(),
        // When a request last came with it, to within a minute, or null for
        // one never used
        last_used_at: timestamp(),
        created_at: timestamp().notNull().defaultNow()
    },
    (table) => [
        index("api_tokens_user_id_index").on(table.user_id),
        check(
            "api_tokens_scopes_check",
            sql.raw(
                `"${table.scopes.name}" <@ array[${AGENT_SCOPES.map((scope) => `'${scope}'`).join(", ")}]::text[] and cardinality("${table.scopes.name}") > 0`
            )
        )
    ]
)

// A visit to the site, a row each: one visitor's page events until 30
// minutes pass without one (backend/visits/, whose README has the rules).
// What the site's own analytics reads: who came, from where, to which page,
// on what, and whether they stayed. Everything from `started_at` to
// `ad_network` is worked out from the visit's events
// (backend/visits/summarize.ts) each time more of them arrive, so a visit
// outlives its events, which are deleted sooner (backend/visits/prune.ts).
// A remembered visitor's IP address is kept on their visit for as long as
// its events are, and nobody else's ever is.
export const analytics_visits = pgTable(
    "analytics_visits",
    {
        id: id(),
        // Who the visitor was: the lasting ID in their `visitor` cookie,
        // when the site remembers them, or else a hash for the day
        // (`anonymous`)
        visitor_id: text().notNull(),
        // Whether `visitor_id` is the day's hash, of their network, their
        // User-Agent and a salt replaced each day (backend/visits/
        // visitors.ts): a visitor the site doesn't remember, who can't be
        // told from anyone once the day is over
        anonymous: boolean().notNull(),
        // Whoever was logged in, only of a visitor the site remembers: the
        // day's hash is never kept beside who someone is
        user_id: uuid().references(() => users.id, { onDelete: "set null" }),
        // Its first event and its last, by the server's clock
        started_at: timestamp().notNull(),
        ended_at: timestamp().notNull(),
        // How many pages it viewed, and links and buttons it clicked
        views: integer().notNull().default(0),
        clicks: integer().notNull().default(0),
        // One page viewed at most, and nothing clicked
        bounced: boolean().notNull().default(true),
        // The first page it viewed and the last, without query or fragment
        landing_path: text(),
        exit_path: text(),
        // Where it came from, as its landing said: the other site's
        // hostname, the campaign in the address, and whose ad was clicked
        // (`google`, `meta`, `microsoft`, `tiktok` or `linkedin`, by the
        // click ID in the address)
        referrer: text(),
        utm_source: text(),
        utm_medium: text(),
        utm_campaign: text(),
        utm_term: text(),
        utm_content: text(),
        ad_network: text(),
        // The visitor's IP address as the visit started, only of a visitor
        // the site remembers: the day's hash is never kept beside an
        // address, which would undo it. Blanked once the visit is
        // `KEEP_IP_ADDRESSES_FOR` old (backend/visits/prune.ts)
        ip_address: inet(),
        // Where the visitor was, from their IP address, when the server
        // could tell (backend/visits/location.ts): an ISO 3166-1 country
        // code, like `US`, and, only with the city database, its region's
        // and city's names
        country: text(),
        region: text(),
        city: text(),
        // What they were on, from their browser's User-Agent, which isn't
        // kept (backend/visits/browsers.ts)
        device: text({ enum: DEVICES }),
        browser: text(),
        os: text()
    },
    (table) => [
        // A report's window, and the visits old enough to delete
        index("analytics_visits_started_at_index").on(table.started_at),
        // A visitor's latest visit, which their next event joins or follows
        index("analytics_visits_visitor_id_ended_at_index").on(
            table.visitor_id,
            table.ended_at
        ),
        // The addresses old enough to blank, and only those: the rest of
        // the visits have none
        index("analytics_visits_ip_address_started_at_index")
            .on(table.started_at)
            .where(sql`${table.ip_address} is not null`),
        // Whose visits to unlink when a user is removed
        index("analytics_visits_user_id_index")
            .on(table.user_id)
            .where(sql`${table.user_id} is not null`)
    ]
)

// What happened on the site, an event a row: a page a visitor viewed or
// left, a click, an error, an event of the app's own from a page
// (`track()`), and what only the server knows, like a sign-up
// (backend/visits/record.ts). A page's belong to a visit; the server's
// don't. Kept `KEEP_EVENTS_FOR` (backend/visits/prune.ts), while their
// visits stay.
export const analytics_events = pgTable(
    "analytics_events",
    {
        id: id(),
        source: text({ enum: EVENT_SOURCES }).notNull(),
        // Lowercase words joined by hyphens: `view`, `leave`, `click`,
        // `error`, or the app's own, like `booked-a-call`
        name: text().notNull(),
        // The visit a page's event belongs to: null for the server's
        visit_id: uuid().references(() => analytics_visits.id, {
            onDelete: "cascade"
        }),
        // The visitor, as their visit has them. On a server's event, the
        // ID in their `visitor` cookie when the server knows it, which
        // joins it to their visits.
        visitor_id: text(),
        // Whoever was logged in, or whoever a server's event is about
        user_id: uuid().references(() => users.id, { onDelete: "set null" }),
        // The page's path, without its query or fragment, which can hold a
        // token or an address
        path: text(),
        // The rest, flat: a string, number, boolean or null by name
        // (`event_properties` in utilities/schemas/events.ts). Read back
        // through that schema, since an older version may have written it.
        properties: jsonb().notNull().default({}),
        // When it happened: by the server's clock, a page's corrected for
        // how far the browser's clock is off
        occurred_at: timestamp().notNull()
    },
    (table) => [
        // A report's window, and the events old enough to delete
        index("analytics_events_occurred_at_index").on(table.occurred_at),
        // A visit's events, which it's worked out from
        index("analytics_events_visit_id_index").on(table.visit_id),
        // Whose events to unlink when a user is removed
        index("analytics_events_user_id_index")
            .on(table.user_id)
            .where(sql`${table.user_id} is not null`)
    ]
)

// Each webhook another service posted the app, at /api/webhooks/<source>
// (backend/webhooks/), kept as it came before anything else happens to it,
// so a delivery that was refused or failed can be read, and checked again,
// with SQL. Kept `KEEP_DELIVERIES_FOR` (backend/webhooks/prune.ts).
export const webhook_deliveries = internal.table(
    "webhook_deliveries",
    {
        id: id(),
        // Its source's name, the path's last part (`stripe`)
        source: text().notNull(),
        received_at: timestamp().notNull().defaultNow(),
        // The sender's own ID for it, which it sends again with a retry
        // (Standard Webhooks' `webhook-id`), when it has one
        delivery_id: text(),
        // Its headers, by their lowercase names, but for any that would let
        // someone in (`authorization`, `cookie`)
        headers: jsonb().notNull(),
        // Its body, exactly as it came, which its signature is over
        body: text().notNull(),
        // What came of it (utilities/webhooks.ts)
        outcome: text({ enum: WEBHOOK_OUTCOMES }).notNull().default("received"),
        // Why it was refused or failed, for whoever reads it
        problem: text(),
        // The events it queued, each with the runs it queued (`[{ name,
        // runs }]`), read back through `queued_events` in
        // backend/webhooks/deliveries.ts
        events: jsonb().notNull().default([])
    },
    (table) => [
        check(
            "webhook_deliveries_outcome_check",
            sql.raw(
                `"${table.outcome.name}" in (${WEBHOOK_OUTCOMES.map((outcome) => `'${outcome}'`).join(", ")})`
            )
        ),
        // The deliveries old enough to delete
        index("webhook_deliveries_received_at_index").on(table.received_at),
        // A source's deliveries, and a delivery's retries, by the sender's ID
        index("webhook_deliveries_source_delivery_id_index").on(
            table.source,
            table.delivery_id
        )
    ]
)
