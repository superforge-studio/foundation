import { pgSchema } from "drizzle-orm/pg-core"

// The Postgres schemas our tables are in, beside `public`
// (../schema.ts says what goes in each). A table in one is
// `auth.table(...)` or `internal.table(...)`. They're in a file of their
// own, which imports nothing of ours, so the template's tables and the
// app's can point at each other without either needing the other loaded
// first.
export const auth = pgSchema("auth")
export const internal = pgSchema("internal")
