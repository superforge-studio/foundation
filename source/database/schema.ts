// Drizzle table definitions (Postgres): the source of truth for the schema.
// Change a table, run `pnpm database:generate`, and commit the migration
// with it (workbench/writing-code.md, "Data"). Every table is exported from
// here, so the code imports them all from `@/database/schema`, and each is
// declared in the file of whoever owns it, in ./schema/:
//
// - `foundation.ts`: the template's tables, which an update from the
//   template changes. Never add a table there.
// - `app.ts`: this app's own, which no update touches. A table of the
//   business's goes there, and starts like this:
//
//   export const customers = pgTable("customers", {
//       id: id(),
//       name: text().notNull(),
//       created_at: timestamp().notNull().defaultNow()
//   })
//
// The conventions:
// - A table that is the thing itself is named for it, in the plural
//   (`users`, `files`). Every other table starts with what it's about,
//   then what its rows are (`file_folders` for the folders the files are
//   in, `customer_notes` for what belongs to a customer), or with the area
//   it's part of when it hangs off nothing (`analytics_visits`), so a
//   feature's tables sort together, with snake_case columns, which Drizzle
//   keeps as written. The Postgres schema already says who sees a table, so
//   its name never repeats it (`auth.sessions`).
// - A single value the server keeps for itself, like a day's salt, is a
//   file in the Storage bucket (storage/files.ts), not a table of one row.
// - Our own rows are keyed by a uuid (`id()` in columns.ts), which Postgres
//   makes, and a column that points at one is a `uuid()`, or by what makes
//   them unique when that's natural, like a session by its token's hash.
//   A row that people need to read or say aloud gets a field of its own for
//   it, like a number or a slug, rather than a shorter key.
// - Every timestamp is a `timestamptz` to the millisecond (`timestamp()`),
//   compared against `now` and `fromNow` from time.ts.
// - Every table gets sample rows in seed/seed.ts in the same change, or a
//   line in its UNSEEDED saying why not, which seed/tests/ checks.
// - A table goes in one of four Postgres schemas, by who owns its rows and
//   who sees them, never one per feature (features are folders in code):
//   - `public`: the business's own data, whatever the app is built to do,
//     its users among it: they're its team, whom its other tables point
//     at. A table here is `pgTable(...)`.
//   - `auth`: what lets someone in: their sessions and their API tokens.
//     The most sensitive rows, since one is as good as a password, kept
//     apart so a read-only role can leave them out. A table here is
//     `auth.table(...)`. The login codes aren't here: Infra keeps them.
//   - `internal`: the rest of the machinery, what no person sees, like
//     the webhooks' deliveries or rate limits. A table here is
//     `internal.table(...)`.
//   - `dbos`: DBOS's own tables, the workflows' runs and their steps
//     (backend/workflows/), which it makes and migrates itself. Nothing
//     here writes to it, and it isn't declared in ./schema/.

export * from "./schema/app"
export * from "./schema/foundation"
