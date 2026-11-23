import { defineConfig } from "drizzle-kit"

// Schema-first: `source/database/schema.ts` is the source of truth, which
// exports the template's tables and the app's own (./source/database/schema/).
// `pnpm database:generate` diffs it into a SQL migration under
// source/database/migrations, which is committed and reviewed like code.
// Drizzle Kit only writes migrations here; `pnpm database:migrate`
// (source/database/migrate.ts) applies them, before each deploy on Railway.
export default defineConfig({
    dialect: "postgresql",
    schema: "./source/database/schema.ts",
    out: "./source/database/migrations",
    // Our Postgres schemas (schema.ts). DBOS's, `dbos`, is its own to make
    // and migrate, so Drizzle Kit leaves it alone
    schemaFilter: ["public", "auth", "internal"]
})
