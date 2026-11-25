import { randomUUID } from "node:crypto"
import { getTableColumns, getTableName, is } from "drizzle-orm"
import { getTableConfig, PgTable } from "drizzle-orm/pg-core"
import type pg from "pg"
import { z } from "zod"
import * as schema from "../../schema"
import { APP_SAMPLES } from "./app"

// Sample rows in every table of a database, whatever version of the schema
// it's at, read from Postgres's catalog rather than from schema.ts: the
// upgrade test fills a database at the base branch's version, then applies
// the PR's migrations over it (upgrade.test.ts). The rows are shaped to trip
// a migration that existing rows break:
// - every nullable column is null in the first row, so a new NOT NULL fails
// - a column outside every key holds the same value in each other row, so a
//   new unique index on it fails
// - keys, and columns in a unique constraint, differ from row to row
// - a foreign key names a row of the table it points at, every column of a
//   key over several (`(account_id, contact_id)`) from the same row
// Where a check constraint lists a text column's values (`text({ enum })`
// in schema.ts), or a list column's (`<@ array[…]`), the rows use them,
// read from the database's own check, so
// a table schema.ts has since renamed gets them too. Where a check wants
// exactly one of several columns set (`num_nonnulls(user_id, contact_id) =
// 1`), or at least one (`>= 1`), each row sets one of them, in turn, and
// leaves the others null. Where a check wants one column after another
// (`ends_at > starts_at`), the later one's sample is further along.

const ROWS = 3

// The Postgres schemas whose tables get rows: every one of ours (schema.ts),
// but not DBOS's, which DBOS migrates itself
export const SCHEMAS = ["public", "auth", "internal"]

type Column = {
    name: string
    type: string
    nullable: boolean
    defaulted: boolean
    // Part of the primary key or a unique constraint
    unique: boolean
    // The values a check constraint allows it, if one lists them
    listed: string[] | null
    // When a check wants exactly one of `of` columns set, this the `at`th of
    // them, which a row sets when its number comes round to it
    one_of: { of: number; at: number } | null
    // Whether a check wants it greater than another column, like an end
    // after its start
    later: boolean
    references: {
        table: string
        column: string
        // Whether a column of its foreign key is in a key, so a row's
        // parent is the parent's row of the same number, the same for every
        // column of the key
        keyed: boolean
    } | null
}

// The catalog's rows, as tablesInOrder() reads them: each column, and each
// column of a key, with what a foreign key points at
const column_row = z.object({
    table_name: z.string(),
    column_name: z.string(),
    type: z.string(),
    nullable: z.boolean(),
    defaulted: z.boolean()
})
const check_row = z.object({
    table_name: z.string(),
    column_name: z.string(),
    definition: z.string()
})
const several_row = z.object({
    table_name: z.string(),
    definition: z.string()
})
const key_row = z.object({
    table_name: z.string(),
    column_name: z.string(),
    kind: z.string(),
    constraint_name: z.string().nullable(),
    references_table: z.string().nullable(),
    references_column: z.string().nullable()
})

/**
 * Fills every table in `SCHEMAS`, and says how many rows each got, by its
 * name: bare in `public`, and after its schema in another, like
 * `internal.webhook_deliveries` (`tableName()`).
 */
export async function fill(client: pg.ClientBase) {
    const tables = await tablesInOrder(client)
    const counts: Record<string, number> = {}
    const written = new Map<string, Record<string, unknown>[]>()

    for (const [table, columns] of tables) {
        const rows: Record<string, unknown>[] = []
        for (let row = 0; row < ROWS; row++) {
            const values = new Map<string, unknown>()
            for (const column of columns) {
                const value = valueFor(table, column, row, written)
                if (value !== undefined) {
                    values.set(column.name, value)
                }
            }
            const names = [...values.keys()]
            const into = table
                .split(".")
                .map((part) => `"${part}"`)
                .join(".")
            const query =
                names.length === 0
                    ? `insert into ${into} default values returning *`
                    : `insert into ${into} (${names.map((name) => `"${name}"`).join(", ")}) values (${names.map((_, at) => `$${at + 1}`).join(", ")}) returning *`
            const result = await client.query(query, [...values.values()])
            rows.push(...result.rows)
        }
        written.set(table, rows)
        counts[table] = rows.length
    }
    return counts
}

// A column's value in a row, or undefined to leave it to its default
function valueFor(
    table: string,
    column: Column,
    row: number,
    written: Map<string, Record<string, unknown>[]>
) {
    if (column.one_of !== null) {
        return row % column.one_of.of === column.one_of.at
            ? setValue(table, column, row, written)
            : null
    } else if (column.nullable && row === 0 && !column.unique) {
        return null
    } else {
        return setValue(table, column, row, written)
    }
}

// A column's value in a row that sets it, or undefined to leave it to its
// default
function setValue(
    table: string,
    column: Column,
    row: number,
    written: Map<string, Record<string, unknown>[]>
) {
    if (column.references !== null) {
        // A distinct parent for each row, when the column, or its foreign
        // key, is in a key
        const parents = written.get(column.references.table) ?? []
        const parent =
            parents[column.unique || column.references.keyed ? row : 0]
        return parent?.[column.references.column] ?? null
    } else if (column.defaulted && column.unique) {
        // A generated key, like a uuid
        return undefined
    } else {
        // Past every other column's variant, when a check wants it later
        const ahead = column.later ? ROWS : 0
        return sample(table, column, (column.unique ? row : 1) + ahead)
    }
}

// A value of the column's type: the `variant`th of its kind, the app's own
// sample first, by its column or its type (./app.ts)
function sample(table: string, column: Column, variant: number) {
    const own =
        APP_SAMPLES[`${table}.${column.name}`] ?? APP_SAMPLES[column.type]
    if (own !== undefined) {
        return own(variant)
    }
    const listed = column.listed ?? enumValues(table, column.name)
    if (listed !== undefined && column.type === "_text") {
        // A list column whose check names what it may hold, like a token's
        // scopes: one of them
        return [listed[variant % listed.length]]
    } else if (listed !== undefined) {
        return listed[variant % listed.length]
    }
    switch (column.type) {
        case "uuid":
            return randomUUID()
        case "text":
            return `sample-${variant}`
        case "_text":
            return [`sample-${variant}`]
        case "int2":
        case "int4":
        case "int8":
        case "numeric":
        case "float4":
        case "float8":
            return variant
        case "bool":
            return variant % 2 === 1
        case "timestamptz":
        case "timestamp":
        case "date":
            return new Date(Date.UTC(2026, 0, 1 + variant))
        case "jsonb":
        case "json":
            return JSON.stringify({ sample: variant })
        case "inet":
            // An address set aside for documentation (RFC 5737)
            return `203.0.113.${(variant % 254) + 1}`
        default:
            throw new Error(
                `fill() has no sample for ${table}.${column.name}, of type ${column.type}`
            )
    }
}

/** A table's name as `fill()` counts it: bare in `public`, else qualified. */
export function tableName(table: PgTable) {
    const { schema: in_schema = "public" } = getTableConfig(table)
    const name = getTableName(table)
    return in_schema === "public" ? name : `${in_schema}.${name}`
}

// The values schema.ts lists for a text column, if it lists any
function enumValues(table: string, column: string) {
    for (const value of Object.values(schema)) {
        if (is(value, PgTable) && tableName(value) === table) {
            const found = Object.values(getTableColumns(value)).find(
                (each) => each.name === column
            )
            if (found !== undefined && found.enumValues !== undefined) {
                return found.enumValues.length > 0
                    ? found.enumValues
                    : undefined
            }
        }
    }
    return undefined
}

// A table's name as `tableName()` gives it, in the catalog's SQL: from the
// aliases of its row in pg_namespace and in pg_class
function qualifiedName(namespace: string, table: string) {
    return `case when ${namespace}.nspname = 'public' then ${table}.relname else ${namespace}.nspname || '.' || ${table}.relname end`
}

// The column a foreign key points at, from the catalog's row for it
function referenceOf(key: z.infer<typeof key_row> | undefined, keyed: boolean) {
    if (
        key === undefined ||
        key.references_table === null ||
        key.references_column === null
    ) {
        return null
    } else {
        return {
            table: key.references_table,
            column: key.references_column,
            keyed
        }
    }
}

// Every table in `SCHEMAS`, with its columns, each after the tables its
// foreign keys point at. A table is named as `tableName()` names it.
async function tablesInOrder(client: pg.ClientBase) {
    const { rows: column_rows } = await client.query(
        `
        select ${qualifiedName("schemas", "tables")} as table_name,
            columns.attname as column_name, types.typname as type,
            not columns.attnotnull as nullable,
            (columns.atthasdef or columns.attidentity <> ''
                or columns.attgenerated <> '') as defaulted
        from pg_attribute columns
        join pg_class tables on tables.oid = columns.attrelid
        join pg_namespace schemas on schemas.oid = tables.relnamespace
        join pg_type types on types.oid = columns.atttypid
        where schemas.nspname = any($1) and tables.relkind in ('r', 'p')
            and columns.attnum > 0 and not columns.attisdropped
        order by schemas.nspname, tables.relname, columns.attnum
    `,
        [SCHEMAS]
    )
    const { rows: key_rows } = await client.query(
        `
        select ${qualifiedName("schemas", "tables")} as table_name,
            columns.attname as column_name, constraints.contype as kind,
            constraints.conname as constraint_name,
            ${qualifiedName("referenced_schemas", "referenced_tables")}
                as references_table,
            referenced_columns.attname as references_column
        from pg_constraint constraints
        join pg_class tables on tables.oid = constraints.conrelid
        join pg_namespace schemas on schemas.oid = tables.relnamespace
        cross join lateral unnest(constraints.conkey)
            with ordinality as own(attnum, position)
        join pg_attribute columns on columns.attrelid = tables.oid
            and columns.attnum = own.attnum
        left join pg_class referenced_tables
            on referenced_tables.oid = constraints.confrelid
        left join pg_namespace referenced_schemas
            on referenced_schemas.oid = referenced_tables.relnamespace
        left join pg_attribute referenced_columns
            on referenced_columns.attrelid = constraints.confrelid
            and referenced_columns.attnum = constraints.confkey[own.position]
        where schemas.nspname = any($1)
            and constraints.contype in ('p', 'u', 'f')
        union
        select ${qualifiedName("schemas", "tables")}, columns.attname, 'u',
            null, null, null
        from pg_index indexes
        join pg_class tables on tables.oid = indexes.indrelid
        join pg_namespace schemas on schemas.oid = tables.relnamespace
        join pg_attribute columns on columns.attrelid = tables.oid
            and columns.attnum = any(indexes.indkey)
        where schemas.nspname = any($1) and indexes.indisunique
    `,
        [SCHEMAS]
    )
    // Each check on one column, which lists its values when it's a
    // `text({ enum })`'s: `CHECK ((outcome = ANY (ARRAY['done'::text, …])))`
    const { rows: check_rows } = await client.query(
        `
        select ${qualifiedName("schemas", "tables")} as table_name,
            columns.attname as column_name,
            pg_get_constraintdef(constraints.oid) as definition
        from pg_constraint constraints
        join pg_class tables on tables.oid = constraints.conrelid
        join pg_namespace schemas on schemas.oid = tables.relnamespace
        join pg_attribute columns on columns.attrelid = tables.oid
            and columns.attnum = constraints.conkey[1]
        where schemas.nspname = any($1) and constraints.contype = 'c'
            and cardinality(constraints.conkey) = 1
    `,
        [SCHEMAS]
    )
    // Each check over several columns, for those that want exactly one of
    // them set, or at least one, `CHECK ((num_nonnulls(user_id, contact_id)
    // = 1))`, and those that want one after another, `CHECK ((ends_at >
    // starts_at))`
    const { rows: several_rows } = await client.query(
        `
        select ${qualifiedName("schemas", "tables")} as table_name,
            pg_get_constraintdef(constraints.oid) as definition
        from pg_constraint constraints
        join pg_class tables on tables.oid = constraints.conrelid
        join pg_namespace schemas on schemas.oid = tables.relnamespace
        where schemas.nspname = any($1) and constraints.contype = 'c'
            and cardinality(constraints.conkey) > 1
    `,
        [SCHEMAS]
    )
    const columns = column_row.array().parse(column_rows)
    const keys = key_row.array().parse(key_rows)
    const checks = check_row.array().parse(check_rows)
    const several = several_row.array().parse(several_rows)
    const one_of_groups = several.flatMap((check) => {
        const named = /num_nonnulls\(([^)]*)\) >?= 1/.exec(check.definition)
        return named?.[1] === undefined
            ? []
            : [
                  {
                      table: check.table_name,
                      columns: named[1]
                          .split(",")
                          .map((name) => name.trim().replaceAll('"', ""))
                  }
              ]
    })

    // The columns a check wants greater than another
    const later_columns = several.flatMap((check) => {
        const named = /^CHECK \(\("?(\w+)"? > "?(\w+)"?\)\)$/.exec(
            check.definition
        )
        return named?.[1] === undefined
            ? []
            : [{ table: check.table_name, column: named[1] }]
    })
    const later = (table: string, column: string) =>
        later_columns.some(
            (each) => each.table === table && each.column === column
        )

    // Where a column stands among columns a check wants exactly one of
    const oneOf = (table: string, column: string) => {
        for (const group of one_of_groups) {
            const at = group.columns.indexOf(column)
            if (group.table === table && at >= 0) {
                return { of: group.columns.length, at }
            }
        }
        return null
    }

    // The values a column's check lists, or null when no check lists any:
    // only a list's (`= ANY (ARRAY[…])`, or a list column's `<@ ARRAY[…]`),
    // not a pattern's, like a slug's `CHECK ((slug ~ '^[a-z0-9]+…'::text))`,
    // whose quoted text isn't a value
    const listed = (table: string, column: string) => {
        for (const check of checks) {
            if (
                check.table_name === table &&
                check.column_name === column &&
                (check.definition.includes("ANY (ARRAY[") ||
                    check.definition.includes("<@ ARRAY["))
            ) {
                const values = [
                    ...check.definition.matchAll(/'((?:[^']|'')*)'::text/g)
                ].map((match) => (match[1] ?? "").replaceAll("''", "'"))
                if (values.length > 0) {
                    return values
                }
            }
        }
        return null
    }

    // Whether a column is in its table's primary key or a unique constraint
    const unique = (table: string, column: string) =>
        keys.some(
            (key) =>
                key.table_name === table &&
                key.column_name === column &&
                (key.kind === "p" || key.kind === "u")
        )

    const tables = new Map<string, Column[]>()
    for (const row of columns) {
        const own = keys.filter(
            (key) =>
                key.table_name === row.table_name &&
                key.column_name === row.column_name
        )
        const reference = own.find((key) => key.kind === "f")
        const keyed =
            reference !== undefined &&
            keys.some(
                (key) =>
                    key.table_name === row.table_name &&
                    key.constraint_name === reference.constraint_name &&
                    unique(row.table_name, key.column_name)
            )
        const list = tables.get(row.table_name) ?? []
        list.push({
            name: row.column_name,
            type: row.type,
            nullable: row.nullable,
            defaulted: row.defaulted,
            unique: own.some((key) => key.kind === "p" || key.kind === "u"),
            listed: listed(row.table_name, row.column_name),
            one_of: oneOf(row.table_name, row.column_name),
            later: later(row.table_name, row.column_name),
            references: referenceOf(reference, keyed)
        })
        tables.set(row.table_name, list)
    }

    // Parents first. A table that points at itself is filled as it goes.
    const ordered: [string, Column[]][] = []
    const placed = new Set<string>()
    while (placed.size < tables.size) {
        const ready = [...tables].filter(
            ([table, list]) =>
                !placed.has(table) &&
                list.every(
                    (column) =>
                        column.references === null ||
                        column.references.table === table ||
                        placed.has(column.references.table)
                )
        )
        if (ready.length === 0) {
            throw new Error("fill() can't order tables whose keys form a cycle")
        }
        for (const entry of ready) {
            ordered.push(entry)
            placed.add(entry[0])
        }
    }
    return ordered
}
