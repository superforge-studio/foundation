import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { is } from "drizzle-orm"
import { PgTable } from "drizzle-orm/pg-core"
import { expect, test } from "vitest"
import { z } from "zod"
import * as schema from "@/database/schema"
import { testDatabase } from "@/database/tests/support/database"
import { tableName } from "@/database/tests/support/fill"
import { seed, UNSEEDED } from "../seed"

// The seed (`pnpm database:seed`), on an empty database with every
// migration, so a schema change that breaks it fails here rather than in the
// next person's dev server. Seeding twice replaces, rather than adds to, what
// the first wrote. And every table in schema.ts gets sample rows, or says in
// UNSEEDED why it has none, so a new table can't ship without either.

test("seeds an empty database, and seeds it again the same", async () => {
    const database = await testDatabase()
    const first = await seed(database)
    const second = await seed(database)
    expect(second).toEqual(first)
})

test("seeds every table, but the ones that say why not", async () => {
    const database = await testDatabase()
    const written = await seed(database)
    const tables = Object.values(schema)
        .filter((value) => is(value, PgTable))
        .map((table) => tableName(table))

    const missing = tables.filter(
        (table) => written[table] === undefined && UNSEEDED[table] === undefined
    )
    expect(
        missing,
        "Each of these tables needs a seeder in SEEDERS, or its reason in UNSEEDED (source/database/seed/seed.ts)"
    ).toEqual([])

    const empty = Object.entries(written)
        .filter(([, rows]) => rows === 0)
        .map(([table]) => table)
    expect(empty, "Each of these seeders wrote no rows").toEqual([])

    const unknown = [...Object.keys(written), ...Object.keys(UNSEEDED)].filter(
        (table) => !tables.includes(table)
    )
    expect(
        unknown,
        "These are named in seed.ts, but schema.ts has no such table"
    ).toEqual([])
})

test("nothing the server runs or deploys reaches the seed, which writes only this checkout's own Postgres", () => {
    // The seed's sample session logs someone in by a cookie anyone can
    // read here, so it must never reach production: only
    // `pnpm database:seed` runs it (workbench/scripts/seed.mjs), on
    // localDatabaseUrl(), never DATABASE_URL
    const root = path.resolve(import.meta.dirname, "../../../..")
    const reaching = readdirSync(path.join(root, "source"), {
        recursive: true,
        encoding: "utf8"
    })
        .filter((file) => /\.tsx?$/.test(file))
        .filter((file) => !file.startsWith(path.join("database", "seed")))
        .filter((file) =>
            /database\/seed/.test(
                readFileSync(path.join(root, "source", file), "utf8")
            )
        )
    expect(reaching).toEqual([])
    const seed = readFileSync(
        path.join(root, "source/database/seed/seed.ts"),
        "utf8"
    )
    expect(seed).toContain("localDatabaseUrl()")
    expect(seed).not.toContain("DATABASE_URL")
    const { scripts } = z
        .object({ scripts: z.record(z.string(), z.string()) })
        .parse(
            JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))
        )
    expect(
        Object.keys(scripts).filter((name) => scripts[name]?.includes("seed"))
    ).toEqual(["database:seed"])
    expect(
        readFileSync(path.join(root, ".railway/railway.ts"), "utf8")
    ).not.toContain("seed")
})
