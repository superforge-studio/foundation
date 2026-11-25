import type { Database } from "@/database"
import type { Storage } from "@/database/storage"
import type { VisitorMode } from "@/utilities/visitors"
import type { AppVariables } from "./app"
import type { Access } from "./auth/access"
import type { Infra, InfraUsing } from "./infra"
import type { Locate } from "./visits/location"
import type { WebhookSource } from "./webhooks/sources"
import type { Workflows } from "./workflows/define"

// What every API route sees on its `context`: the database, the Storage
// bucket, the workflows, Superforge Infra and which one it is (the real
// one with a key, its stand-in, or nothing), who can log in, whom the site
// remembers, what places a visitor by their IP address, and the services
// that post the app webhooks, and whatever this app adds of its own
// (`AppVariables`, ./app.ts). `index.ts` puts the server's there, and a
// test its own (tests/support/api.ts).
export type ApiEnvironment = {
    Variables: {
        database: Database
        storage: Storage
        workflows: Workflows
        infra: Infra
        infra_using: InfraUsing
        access: Access
        visitor_mode: VisitorMode
        locate: Locate
        webhook_sources: WebhookSource[]
    } & AppVariables
}
