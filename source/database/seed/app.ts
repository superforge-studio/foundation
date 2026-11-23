import type { ScriptRun } from "@/backend/workflows/engine"
import type { Database } from "@/database"
import type { Seeder } from "./seed"

/**
 * This app's own seeders, run after the template's (./seed.ts), in the
 * order they run: a table after the ones its rows point at. **Every table
 * in ../schema/app.ts gets one here**, in the same change that adds it,
 * written as ./seed.ts's header says, or a reason in `APP_UNSEEDED`. They're
 * here, apart from the template's, so an update from the template never
 * meets them. One that names a table the template seeds runs after the
 * template's, and what it writes is what's left.
 */
export const APP_SEEDERS: Seeder[] = []

/**
 * This app's own tables that get no sample rows, each with why, by its
 * name as a seeder names it: bare in `public`, after its schema in
 * another.
 */
export const APP_UNSEEDED: Record<string, string> = {}

/**
 * The runs this app's sample rows would have started, for
 * `pnpm database:seed` to put on their queues once the rows are written,
 * so a dev server runs them (./seed.ts, `seedLocalDatabase`): none, as the
 * template ships.
 */
export async function appSampleRuns(_database: Database): Promise<ScriptRun[]> {
    return []
}
