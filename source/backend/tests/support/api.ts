import { testClient } from "hono/testing"
import { apiWith } from "@/backend"
import { ACCESS, type Access, type InternalUser } from "@/backend/auth/access"
import type { ApiEnvironment } from "@/backend/context"
import { standInInfra } from "@/backend/infra"
import type { Locate } from "@/backend/visits/location"
import { queuedRuns } from "@/backend/workflows/tests/support/queued"
import { recordedWorkflows } from "@/backend/workflows/tests/support/recorded"
import { Storage } from "@/database/storage"
import { testDatabase } from "@/database/tests/support/database"
import { memoryStore } from "@/database/tests/support/storage"
import type { VisitorMode } from "@/utilities/visitors"
import { appTestVariables } from "./app"

// Who can log in, in a test unless it says otherwise: no one, whatever this
// app's ACCESS lists, until the test logs someone in (login.ts), each role
// with what this app gives it
const NOBODY: Access = { internal_users: [], roles: ACCESS.roles }

// Whom the site remembers, in a test unless it says otherwise: the mode
// the template ships with, whatever this app's VISITOR_MODE says
const REMEMBER: VisitorMode = "remember"

// Where a visitor is, in a test unless it says otherwise: nowhere the
// server can tell, as in a dev server, so no test downloads a database
const NOWHERE: Locate = () => null

/**
 * The whole API, as the server mounts it (`apiWith()`), on a database of
 * the test's own, the bucket's bytes in memory, workflows recorded rather
 * than run (and those a write queues in its own transaction left on their
 * queues, which `queued()` reads), Infra's stand-in, so no test reaches Infra (its logins
 * answer their code, as a test key's do), said to be the stand-in
 * (`infra_using`), so nothing keeps a comment until a test says it calls
 * Infra with a key, no one on the team until the
 * test logs someone in, visitors remembered as the template ships (`remember`), none of them
 * placed, no webhook sources, and this app's own stand-ins (./app.ts): what a route's test calls, through the typed client
 * (`client.api.health.$get()`), or `api.request(path)` for a path no route
 * declares. Anything in `replacing` goes on `context` in place of the
 * test's own. Call it inside a test.
 */
export async function testApi(
    replacing: Partial<ApiEnvironment["Variables"]> = {}
) {
    const store = memoryStore()
    const recorded = recordedWorkflows()
    // The test's own team, which `logInAs` adds to, so logging someone in
    // lists them, as the code would
    const given = replacing.access ?? NOBODY
    const internal_users: InternalUser[] = [...given.internal_users]
    const own = appTestVariables(replacing)
    const variables: ApiEnvironment["Variables"] = {
        database: replacing.database ?? (await testDatabase()),
        storage: replacing.storage ?? new Storage(store.store),
        workflows: replacing.workflows ?? recorded.workflows,
        infra: replacing.infra ?? standInInfra(),
        infra_using: replacing.infra_using ?? "stand-in",
        access: { internal_users, roles: given.roles },
        visitor_mode: replacing.visitor_mode ?? REMEMBER,
        locate: replacing.locate ?? NOWHERE,
        webhook_sources: replacing.webhook_sources ?? [],
        ...own.variables
    }
    const api = apiWith(() => variables)
    return {
        api,
        client: testClient(api),
        database: variables.database,
        // Everything on `context`, for a test's own Hono app to put there
        // too (`withVariables`, backend/index.ts)
        variables,
        // What the routes kept in the bucket, the workflows they started and
        // retried, the runs the workflows list, which a test can add to, and
        // the runs their writes queued (queueWorkflow, queueEvent)
        files: store.files,
        internal_users,
        started: recorded.started,
        retried: recorded.retried,
        runs: recorded.runs,
        queued: () => queuedRuns(variables.database),
        // What this app's own stand-ins kept, for a test to read
        ...own.looks
    }
}
