import type { Database } from "@/database"
import type { Storage } from "@/database/storage"
import type { VisitorMode } from "@/utilities/visitors"
import type { Access } from "./auth/access"
import type { Infra } from "./infra"
import type { Locate } from "./visits/location"
import type { WebhookSource } from "./webhooks/sources"
import type { Workflows } from "./workflows/define"

// What every API route sees on its `context`: the database, the Storage
// bucket, the workflows, Superforge Infra, who can sign in, whom the site
// remembers, what places a visitor by their IP address, and the services
// that post the app webhooks. `index.ts` puts
// the server's there, and a test its own (tests/support/api.ts).
export type ApiEnvironment = {
    Variables: {
        database: Database
        storage: Storage
        workflows: Workflows
        infra: Infra
        access: Access
        visitor_mode: VisitorMode
        locate: Locate
        webhook_sources: WebhookSource[]
    }
}
