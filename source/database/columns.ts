import { sql } from "drizzle-orm"
import {
    check,
    timestamp as postgresTimestamp,
    text,
    uuid
} from "drizzle-orm/pg-core"

// Column types the schema (schema.ts) shares. drizzle-kit reads it, so this
// imports nothing through the app's `@/` paths.

/** A uuid, made by Postgres. */
export function id() {
    return uuid().primaryKey().defaultRandom()
}

/**
 * A moment, read back as a Date. Kept to the millisecond, as a Date holds
 * it, so a row read back and saved again compares equal to what's stored.
 */
export function timestamp() {
    return postgresTimestamp({ withTimezone: true, precision: 3 })
}

/** A list of strings, empty rather than null. */
export function textList() {
    return text().array().notNull().default(sql`'{}'::text[]`)
}

/**
 * A check that a text column holds one of a fixed list's values, the list
 * its `text({ enum })` is made from, named for its table and column. A null
 * passes, so a nullable column's check is only of what it holds.
 */
export function oneOf(
    name: string,
    column: { name: string },
    values: readonly string[]
) {
    return check(
        name,
        sql.raw(
            `"${column.name}" in (${values.map((value) => `'${value}'`).join(", ")})`
        )
    )
}
