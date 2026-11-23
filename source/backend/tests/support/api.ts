import { testClient } from "hono/testing"
import { apiWith } from "@/backend"
import type { Access, InternalUser } from "@/backend/auth/access"
import type { ApiEnvironment } from "@/backend/context"
import { standInInfra } from "@/backend/infra"
import type { Locate } from "@/backend/visits/location"
import { queuedRuns } from "@/backend/workflows/tests/support/queued"
import { recordedWorkflows } from "@/backend/workflows/tests/support/recorded"
import { Storage } from "@/database/storage"
import { testDatabase } from "@/database/tests/support/database"
import { memoryStore } from "@/database/tests/support/storage"
import type { VisitorMode } from "@/utilities/visitors"

// Who can log in, in a test unless it says otherwise: anyone, with no one
// listed as internal, whatever this app's ACCESS says, until the test logs
// someone in as internal (login.ts)
const OPEN: Access = { login: "anyone", internal_users: [] }

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
 * answer their code, as a test key's do), anyone able to log in,
 * visitors remembered as the template ships (`remember`), none of them
 * placed, and no webhook sources: what a route's test calls, through the typed client
 * (`client.api.health.$get()`), or `api.request(path)` for a path no route
 * declares. Anything in `replacing` goes on `context` in place of the
 * test's own. Call it inside a test.
 */
export async function testApi(
    replacing: Partial<ApiEnvironment["Variables"]> = {}
) {
    const store = memoryStore()
    const recorded = recordedWorkflows()
    // The test's own list of internal users, which `logInAs` adds to, so
    // logging someone in as internal lists them, as the code would
    const given = replacing.access ?? OPEN
    const internal_users: InternalUser[] = [...given.internal_users]
    const variables: ApiEnvironment["Variables"] = {
        database: replacing.database ?? (await testDatabase()),
        storage: replacing.storage ?? new Storage(store.store),
        workflows: replacing.workflows ?? recorded.workflows,
        infra: replacing.infra ?? standInInfra(),
        access: { login: given.login, internal_users },
        visitor_mode: replacing.visitor_mode ?? REMEMBER,
        locate: replacing.locate ?? NOWHERE,
        webhook_sources: replacing.webhook_sources ?? []
    }
    const api = apiWith(() => variables)
    return {
        api,
        client: testClient(api),
        database: variables.database,
        // What the routes kept in the bucket, the workflows they started and
        // retried, the runs the workflows list, which a test can add to, and
        // the runs their writes queued (queueWorkflow, queueEvent)
        files: store.files,
        internal_users,
        started: recorded.started,
        retried: recorded.retried,
        runs: recorded.runs,
        queued: () => queuedRuns(variables.database)
    }
}
