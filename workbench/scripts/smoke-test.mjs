#!/usr/bin/env node
// smoke-test.mjs — the production build, run the way Railway runs it, before
// any of it ships: `pnpm smoke-test` after `pnpm build`, and the last step of
// `pnpm check`'s `code` part (check.sh). The tests try the code; this tries
// what a deploy does with it, which they can't see:
//
//   1. `pnpm database:migrate`, Railway's pre-deploy command, on a new,
//      empty database of its own on this checkout's Postgres
//   2. `pnpm start` (source/node.ts) on a free port, with DATABASE_URL
//   3. /api/health, which Railway's healthcheck waits on, answers 200
//   4. every prerendered page answers 200, the build's hashed files, /api
//      and the dashboard, drawn on request, answer with the cache headers
//      source/node.ts promises, a path that isn't a page answers 404, and
//      a POST to a page 405
//   5. its workflows launched: DBOS registers the app's queues in its own
//      tables once it has (source/backend/workflows/engine.ts)
//   6. with no INFRA_SECRET_KEY, login answers 503, never the stand-in a
//      dev server logs in with (source/backend/infra/choose.ts)
//   7. its traces reach a collector, as they reach Railway's once tracing
//      is on (source/tracing.ts): its requests named for their routes,
//      with their queries inside them, sent as it stops on SIGTERM
//
// So a start script that crashes, a migration that won't apply from empty,
// a page the server can't find, a broken cache header, workflows that
// never start, a build that would show login codes on the page or
// tracing that sees nothing fails here, not in the deploy. It drops its database
// whatever happens.
import { execFileSync, spawn } from "node:child_process"
import { readdirSync } from "node:fs"
import { createServer as createHttpServer } from "node:http"
import { createServer } from "node:net"
import { join, relative } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import pg from "pg"

const NODE = [process.execPath, "--disable-warning=ExperimentalWarning"]
const BUILD = "output/client"

// This checkout's Postgres, started if it isn't running, and a database of
// this run's own on it
const app_url = execFileSync(
    NODE[0],
    [...NODE.slice(1), "source/database/local/server.ts", "url"],
    { encoding: "utf8" }
).trim()
const name = `smoke_test_${process.pid}`
const server_url = new URL(app_url)
server_url.pathname = "/postgres"
const database_url = new URL(app_url)
database_url.pathname = `/${name}`

const problems = []
let server
let server_exited = null

// Railway's collector, as the server finds it once tracing is on: an OTLP
// receiver at the address and with the header Railway's variables give
// (source/tracing.ts), keeping what each export sends
const COLLECTOR_HEADER = "x-smoke-test-collector"
const exports = []
const collector = createHttpServer((request, response) => {
    const chunks = []
    request.on("data", (chunk) => chunks.push(chunk))
    request.on("end", () => {
        exports.push({
            path: request.url,
            type: request.headers["content-type"],
            header: request.headers[COLLECTOR_HEADER],
            body: Buffer.concat(chunks)
        })
        response.writeHead(200, { "Content-Type": "application/x-protobuf" })
        response.end()
    })
})

try {
    await onServer(`create database "${name}"`)

    // 1. The pre-deploy migrations, as Railway runs them
    execFileSync("pnpm", ["--silent", "database:migrate"], {
        env: { ...process.env, DATABASE_URL: database_url.href },
        stdio: "inherit"
    })

    // 2. The server, as Railway starts it, traced, as Railway sets it up
    const port = await freePort()
    const collector_port = await freePort()
    await new Promise((resolve) =>
        collector.listen(collector_port, "127.0.0.1", resolve)
    )
    server = spawn("pnpm", ["--silent", "start"], {
        env: {
            ...process.env,
            DATABASE_URL: database_url.href,
            PORT: String(port),
            // None, whatever the shell has, for step 6
            INFRA_SECRET_KEY: "",
            // Railway's tracing variables, for step 7
            OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${collector_port}`,
            OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
            OTEL_EXPORTER_OTLP_HEADERS: `${COLLECTOR_HEADER}=1`,
            OTEL_SERVICE_NAME: "smoke-test",
            OTEL_TRACES_EXPORTER: "otlp"
        },
        stdio: ["ignore", "inherit", "inherit"],
        detached: true
    })
    server_exited = new Promise((resolve) => server.once("exit", resolve))
    const base = `http://127.0.0.1:${port}`

    // 3. The healthcheck, which Railway waits on before sending traffic
    await waitForHealth(base)

    // 4. What the server answers
    for (const page of prerenderedPages()) {
        await expectAnswer(base, page, 200, "s-maxage=")
    }
    const asset = readdirSync(join(BUILD, "assets")).find((file) =>
        file.endsWith(".js")
    )
    if (asset === undefined) {
        problems.push(`The build has no JavaScript in ${BUILD}/assets`)
    } else {
        await expectAnswer(base, `/assets/${asset}`, 200, "immutable")
    }
    await expectAnswer(base, "/api/health", 200, "no-store")
    // The dashboard, which isn't prerendered: drawn on request, for the
    // browser to fill in, and never kept by the CDN
    await expectAnswer(base, "/dashboard/workflows", 200, "no-store")
    await expectAnswer(base, "/no-page-here", 404, "no-store")
    // A page sent a POST, like a webhook given the site's address, is
    // refused, not drawn and answered 200 (source/server.ts)
    await expectPostRefused(base, "/")

    // 5. The workflows, which launch once the server is listening
    await waitForWorkflows()

    // 6. Login, which a build without INFRA_SECRET_KEY refuses, rather
    //    than falling back to the dev server's stand-in, which shows the
    //    code on the page (source/backend/infra/choose.ts)
    await expectLoginDown(base)

    // 7. The traces, which the server sends its collector in batches, and
    //    the last of as it stops: stopped here as Railway stops it
    await stopServer()
    expectTraces()
} catch (error) {
    problems.push(error instanceof Error ? error.message : String(error))
} finally {
    await stopServer()
    collector.close()
    await onServer(`drop database if exists "${name}" with (force)`)
}

if (problems.length > 0) {
    console.error("\nThe production server, as Railway runs it, failed:")
    for (const problem of problems) {
        console.error(`  ✗ ${problem}`)
    }
    process.exit(1)
} else {
    console.info(
        "\nThe production server migrated, started, passed its healthcheck and served every page"
    )
}

// Stops the server as Railway stops a deployment it replaces, with SIGTERM
// to the whole group, pnpm and the Node server it started, and waits for
// it to exit, after it has sent its last spans
async function stopServer() {
    if (server?.pid === undefined || server.exitCode !== null) {
        return
    }
    try {
        process.kill(-server.pid, "SIGTERM")
    } catch (error) {
        console.error("The server had already stopped", { error })
        return
    }
    const exited = await Promise.race([
        server_exited.then(() => true),
        sleep(20_000).then(() => false)
    ])
    if (!exited) {
        problems.push("The server didn't stop within 20 seconds of SIGTERM")
        process.kill(-server.pid, "SIGKILL")
    }
}

// What the collector was sent: OTLP over HTTP, as protobuf, with Railway's
// header, holding a request named for its route by its app
// (utilities/tracing.ts), with a query of the database inside a request,
// which only an instrumentation that hooked `pg` as the build imports it
// makes. Protobuf keeps each string as its bytes, so the names are found
// in what was sent as they are.
function expectTraces() {
    const sent = exports.filter((each) => each.path === "/v1/traces")
    const body = Buffer.concat(sent.map((each) => each.body))
    if (sent.length === 0) {
        problems.push("The server sent its collector no traces")
        return
    }
    const wrong = sent.find(
        (each) => each.type !== "application/x-protobuf" || each.header !== "1"
    )
    if (wrong !== undefined) {
        problems.push(
            `The server sent traces as ${wrong.type}, with ${COLLECTOR_HEADER} ${wrong.header}, not as protobuf with Railway's header`
        )
    }
    const missing = ["smoke-test", "GET /api/health", "pg.query"].filter(
        (expected) => !body.includes(expected)
    )
    if (missing.length > 0) {
        for (const expected of missing) {
            problems.push(`The server's traces have no "${expected}"`)
        }
    } else {
        console.info(
            `  ✓ the server's traces reached the collector (${sent.length} exports, ${body.length} bytes)`
        )
    }
}

// Runs one statement on the server's own database, for what can't run
// inside the database it changes
async function onServer(statement) {
    const client = new pg.Client({ connectionString: server_url.href })
    await client.connect()
    try {
        await client.query(statement)
    } finally {
        await client.end()
    }
}

// Every page the build prerendered, by its path: output/client/x/index.html
// is /x
function prerenderedPages() {
    const pages = []
    const walk = (folder) => {
        for (const entry of readdirSync(folder, { withFileTypes: true })) {
            const path = join(folder, entry.name)
            if (entry.isDirectory() && entry.name !== "assets") {
                walk(path)
            } else if (entry.name === "index.html") {
                const page = relative(BUILD, folder)
                pages.push(page === "" ? "/" : `/${page}`)
            }
        }
    }
    walk(BUILD)
    if (pages.length === 0) {
        throw new Error(
            `No prerendered pages in ${BUILD}: run pnpm build first`
        )
    }
    return pages
}

async function waitForHealth(base) {
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
        const response = await fetch(`${base}/api/health`).catch(() => null)
        if (response?.ok) {
            return
        }
        await sleep(250)
    }
    throw new Error("/api/health didn't answer 200 within 30 seconds")
}

// Whether DBOS has launched in the server: it registers the app's queues as
// it does, so its `queues` table has them
async function waitForWorkflows() {
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
        const client = new pg.Client({ connectionString: database_url.href })
        await client.connect()
        try {
            const { rows } = await client.query(
                "select count(*)::int as queues from dbos.queues"
            )
            if (rows[0].queues > 0) {
                console.info(
                    `  ✓ the workflows launched (${rows[0].queues} queues)`
                )
                return
            }
        } finally {
            await client.end()
        }
        await sleep(250)
    }
    throw new Error("The workflows didn't launch within 30 seconds")
}

// A login started on a build with no secret key: refused as unavailable,
// with no code in the answer
async function expectLoginDown(base) {
    const response = await fetch(`${base}/api/auth/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "smoke-test@example.com" })
    })
    const body = await response.json().catch(() => null)
    if (response.status !== 503 || body?.error?.reason !== "unavailable") {
        problems.push(
            `POST /api/auth/start without INFRA_SECRET_KEY answered ${response.status} ${JSON.stringify(body)}, not 503 unavailable`
        )
    } else {
        console.info("  ✓ POST /api/auth/start 503, with no secret key")
    }
}

async function expectPostRefused(base, path) {
    const response = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
    })
    if (response.status !== 405) {
        problems.push(`POST ${path} answered ${response.status}, not 405`)
    } else {
        console.info(`  ✓ POST ${path} 405`)
    }
}

async function expectAnswer(base, path, status, cache_control) {
    const response = await fetch(`${base}${path}`)
    const header = response.headers.get("cache-control") ?? ""
    if (response.status !== status) {
        problems.push(`${path} answered ${response.status}, not ${status}`)
    } else if (!header.includes(cache_control)) {
        problems.push(
            `${path} sent Cache-Control "${header}", without "${cache_control}"`
        )
    } else {
        console.info(`  ✓ ${path} ${status} (${header})`)
    }
}

function freePort() {
    return new Promise((resolve, reject) => {
        const probe = createServer()
        probe.once("error", reject)
        probe.listen(0, "127.0.0.1", () => {
            const address = probe.address()
            probe.close(() => resolve(address.port))
        })
    })
}
