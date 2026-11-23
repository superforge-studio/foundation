// This app's own tables, beside the template's (./foundation.ts), which
// ../schema.ts exports together. They're kept apart so an update from the
// template never meets them: add a table here, never there, by the
// conventions ../schema.ts lists, then run `pnpm database:generate`. One
// starts like this, and points at the template's tables as its own do:
//
//   import { pgTable, text, uuid } from "drizzle-orm/pg-core"
//   import { id, timestamp } from "../columns"
//   import { users } from "./foundation"
//
//   export const customers = pgTable("customers", {
//       id: id(),
//       name: text().notNull(),
//       owner_id: uuid().references(() => users.id),
//       created_at: timestamp().notNull().defaultNow()
//   })
//
// A table in `auth` or `internal` takes its Postgres schema from
// ./foundation.ts too (`auth.table(...)`, `internal.table(...)`). Imports
// here are relative, since drizzle-kit reads this file without the app's
// `@/` paths.

export {}
