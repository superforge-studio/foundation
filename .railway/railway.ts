import {
    bucket,
    defineRailway,
    github,
    postgres,
    preserve,
    project,
    ref,
    service,
    type VariableValue
} from "railway/iac"
import { APP } from "./app.ts"

// Railway's four regions, each named as its services and databases name it
// and as its buckets do, by the nearest airport's code (iad is Washington
// Dulles): https://docs.railway.com/deployments/regions, and `railway
// bucket create --help` for the buckets'.
const REGIONS = {
    // California
    "us-west": { service: "us-west2", bucket: "sjc" },
    // Virginia
    "us-east": { service: "us-east4-eqdc4a", bucket: "iad" },
    // Amsterdam
    "europe-west": { service: "europe-west4-drams3a", bucket: "ams" },
    // Singapore
    "asia-southeast": { service: "asia-southeast1-eqsg3a", bucket: "sin" }
} as const

/**
 * What this app says of its own Railway, in ./app.ts: the template's file
 * is this one, and that one is the app's.
 */
export type AppRailway = {
    project: string
    repository: string
    // Railway's own address for the app, `<name>.up.railway.app`, which the
    // first apply needs, since the CDN needs a public domain to start on.
    // An app whose address has gone, and has a domain of its own, leaves it
    // out
    address?: string
    region: keyof typeof REGIONS
    domains: readonly string[]
    env: Record<string, string | VariableValue>
}

// Where the app, its database and its buckets all run, as ./app.ts chose.
// A bucket can't move after it's made, and a database with rows in it moves
// only by hand
const REGION = REGIONS[APP.region]

// Railway's address for the app, or `undefined` if ./app.ts leaves it out.
// Read through the type, since an app.ts without one has no `address` for
// TypeScript to find
const { address: RAILWAY_ADDRESS }: AppRailway = APP

/**
 * The Railway project, as code. `railway config plan` shows what applying
 * it would change and `railway config apply` changes it (README.md here);
 * Railway doesn't read it as it deploys. CI applies it on each push to
 * `main` (.github/workflows/ci.yml), so change Railway here, not in the
 * dashboard. It manages every service variable, so one set in the
 * dashboard and missing here is a deletion, which CI's apply refuses: a
 * secret goes in as `preserve()`, which keeps Railway's value.
 *
 * The project's name, the repository, the app's addresses, its region and
 * its own variables are the app's, in ./app.ts, which START-HERE.md fills
 * in before the first apply makes the project
 * (workbench/commit-and-deploy.md, "Setting up Railway"). The rest is the
 * template's, which updates change: a copy never edits this file.
 */
export default defineRailway(() => {
    // The database, reachable only on the private network
    // (source/database/). Railway gives it its volume.
    const database = postgres("Postgres", { region: REGION.service })
    database.networking = { privateNetworkEndpoint: "postgres" }

    // The database's point-in-time recovery: Postgres sends every change
    // (its WAL) to this bucket as it happens, with a full backup each week
    // and a differential one each day, so it can be restored to any moment
    // in about the last four weeks, as a new service beside this one
    // (workbench/writing-code.md, "Restoring production"). Railway's
    // Postgres image archives whenever the `WAL_ARCHIVE_*` variables are set,
    // so these are what turn it on, from the first apply. They're the ones
    // `railway postgres pitr enable` sets. The bucket is in the database's
    // region.
    const recoveryArchive = bucket("Postgres-PITR", { region: REGION.bucket })
    database.variables = {
        WAL_ARCHIVE_BUCKET: ref(recoveryArchive, "BUCKET"),
        WAL_ARCHIVE_ENDPOINT: ref(recoveryArchive, "ENDPOINT"),
        WAL_ARCHIVE_REGION: ref(recoveryArchive, "REGION"),
        WAL_ARCHIVE_KEY: ref(recoveryArchive, "ACCESS_KEY_ID"),
        WAL_ARCHIVE_SECRET: ref(recoveryArchive, "SECRET_ACCESS_KEY"),
        WAL_ARCHIVE_PATH: { type: "literal", value: "/pgbackrest" }
    }

    // Every file the app keeps, in one bucket with a folder for each kind of
    // file (source/database/storage/). Empty until something keeps one, and
    // an empty bucket costs next to nothing. One bucket rather than one per
    // kind, since Railway's buckets have no lifecycle rules, public access
    // or read-only keys to set apart, and the one app holds every key
    // anyway. In the app's region. It's only on the public network, so the
    // app's uploads count as its egress.
    const storage = bucket("Storage", { region: REGION.bucket })

    // The app: one Node server (source/node.ts), which deploys each push to
    // `main` once its CI passes (`checkSuites`). Named for what it is, so a
    // copy keeps the name; the project and the repository are the app's.
    const app = service("app", {
        source: github(APP.repository, {
            branch: "main",
            checkSuites: true
        }),
        build: {
            builder: "RAILPACK",
            buildEnvironment: "V3",
            buildCommand: "pnpm build"
        },
        start: "pnpm start",
        // The database's pending migrations, in one transaction, before the
        // new deployment starts, while the one before still serves
        // (source/database/migrate.ts). One that fails rolls back and stops
        // the deploy. The timeout sits above the migrations' own statement
        // limit, so a slow one rolls back rather than being killed.
        preDeploy: "pnpm database:migrate",
        //
        // On a deploy, Railway sends the old deployment SIGTERM, and kills it
        // `drainingSeconds` later: long enough for source/node.ts to stop
        // the workflows, finish the requests in flight and send its last
        // spans, which it gives up on a little before. A server that
        // crashes starts again, up to ten times in a row.
        deploy: {
            preDeployTimeoutSeconds: 300,
            drainingSeconds: 30,
            restartPolicyType: "ON_FAILURE",
            restartPolicyMaxRetries: 10
        },
        // Traffic moves to a new deployment only once the server reaches
        // the database
        healthcheck: "/api/health",
        replicas: { [REGION.service]: 1 },
        // Railway's CDN in front of the app: the pages for a day at most, and
        // only until the next deploy, which purges every page (`html`), and
        // the hashed assets for good, by the headers source/node.ts sends
        // (workbench/commit-and-deploy.md, "Caching"). Nothing under /api is
        // kept. `html` is Railway's default, written out so it can't change
        // under us.
        cdn: { enabled: true, purgeOnDeploy: "html" },
        // Railway's tracing (a preview, behind the account's Tracing beta):
        // its edge traces each request to the app's domains, and its next
        // deploy sets the `OTEL_*` variables that point the app's own spans
        // at the collector on its host, which turns source/tracing.ts on.
        // Its traces are on the project's Traces page, and the Railway
        // MCP's `list-traces` and `get-trace` (workbench/writing-code.md,
        // "Logging and tracing"). The app makes its own spans, so not
        // `autoInstrumentation`, which would make each request's twice. A
        // project token, CI's, can't change it, so a change here is made
        // with a login first (workbench/commit-and-deploy.md, "CI and
        // deploys").
        tracing: { enabled: true },
        env: {
            DATABASE_URL: ref(database, "DATABASE_URL"),
            // The Storage bucket's S3 credentials. `BUCKET` is its name for
            // the S3 API, not "Storage"
            STORAGE_BUCKET: ref(storage, "BUCKET"),
            STORAGE_ENDPOINT: ref(storage, "ENDPOINT"),
            STORAGE_REGION: ref(storage, "REGION"),
            STORAGE_ACCESS_KEY_ID: ref(storage, "ACCESS_KEY_ID"),
            STORAGE_SECRET_ACCESS_KEY: ref(storage, "SECRET_ACCESS_KEY"),
            // The secret key of this app's project on Superforge Infra
            // (sf_secret_…), which login calls Infra with
            // (source/backend/infra/). The owner makes it on Superforge's
            // dashboard and sets it here in Railway's dashboard, which
            // `preserve()` keeps; until then, login answers that it's down
            INFRA_SECRET_KEY: preserve(),
            // Which of DB-IP's free databases places a visitor by their IP
            // address, for their visit's country
            // (source/backend/visits/location.ts). The server downloads it
            // as it first needs it, and again each week: 4 MB, and 9 MB in
            // memory. `dbip-city-lite` adds the region and the city, for
            // 120 MB in memory. Without the variable, as in a dev server,
            // no visitor is placed.
            LOCATION_DATABASE: "dbip-country-lite",
            // The app's own (./app.ts)
            ...APP.env
        }
    })
    // Railway's own address for the app, which the first apply makes with
    // the service, since the CDN needs a public domain to start on. After
    // that the file doesn't keep it: if it's deleted, the plan doesn't
    // notice, and an app with a domain of its own can leave it out of
    // ./app.ts. The app's own domains join it, once it has any
    // (workbench/commit-and-deploy.md, "Domains").
    app.networking = {
        ...(RAILWAY_ADDRESS !== undefined && {
            serviceDomains: { [RAILWAY_ADDRESS]: {} }
        }),
        ...(APP.domains.length > 0 && {
            customDomains: Object.fromEntries(
                APP.domains.map((domain) => [domain, {}])
            )
        })
    }

    // `variables` is what the CLI reads to manage them, but the SDK's type
    // doesn't have it yet (railway 3.17.0), so it's passed as a variable,
    // which TypeScript checks without refusing the extra key
    const definition = {
        variables: { managed: true },
        resources: [app, database, recoveryArchive, storage]
    }
    return project(APP.project, definition)
})
