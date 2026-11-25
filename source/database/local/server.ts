import { type SpawnSyncOptions, spawnSync } from "node:child_process"
import {
    chownSync,
    cpSync,
    existsSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    renameSync,
    rmSync,
    symlinkSync,
    writeFileSync
} from "node:fs"
import { createRequire } from "node:module"
import { createServer } from "node:net"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"
import { z } from "zod"
import { startIdleWatch } from "./idle.ts"
import {
    LOCAL_DATABASE,
    localDatabaseUrl,
    localDirectory,
    portFile
} from "./index.ts"

/**
 * Starts this checkout's Postgres (index.ts) and runs the commands the
 * `database:*` scripts in package.json name:
 *
 *   start           start it, if it isn't running, making it the first time
 *   stop            stop it, keeping its data
 *   url             start it, then print the app's database's URL
 *   migrate         start it, then apply the branch's migrations to the app's database
 *   sql "<query>"   start it, then run one query on the app's database, read-only
 *   reset           delete its data, then start it and migrate: an empty database
 *
 * `pnpm dev` and the tests' global setup start it themselves. It runs in
 * the background once started, like a database in Docker would, and keeps
 * running after the command that started it ends, until nothing has been
 * connected to it for half an hour (idle.ts), `pnpm database:stop`, or the
 * machine restarts.
 *
 * Node runs this file from source, stripping its types, so it imports only
 * packages and files beside it, named with their extension.
 */

// How it runs, passed each time it starts, so a change here takes effect
// the next time it does (after `pnpm database:stop`)
const SETTINGS = [
    // Only this machine reaches it, and only over TCP, so checkouts' servers
    // never meet over a socket file
    "-c listen_addresses=127.0.0.1",
    "-c unix_socket_directories=''",
    // As many as Railway's allows (../index.ts), which a run's tests in
    // parallel use plenty of
    "-c max_connections=500",
    // Its data is the seed and the tests' copies, all made again in
    // seconds, so it gives up surviving a crash of the machine for speed (a
    // crash may leave it to `pnpm database:reset`). On Linux, as in CI and
    // a cloud agent, each test's dropped database waited on the disk: the
    // suite took 35 seconds there with hooks timing out, and 20 without
    // (2026-10-26). On a Mac it makes no difference.
    "-c fsync=off",
    "-c synchronous_commit=off",
    "-c full_page_writes=off"
]

/**
 * Starts this checkout's Postgres if it isn't running, making it the first
 * time, makes the app's database on it if it isn't there, and gives it its
 * idle watch if it hasn't one.
 */
export async function startLocalServer() {
    const directory = localDirectory()
    const data = join(directory, "data")
    const owner = serverOwner()
    const tools = binaries(directory, owner)

    // Data from another major version of Postgres, after an update moved
    // the binaries on, can't start: it's only the seed and the tests'
    // copies, so it's made again rather than left to `database:reset`
    const version_file = join(data, "PG_VERSION")
    if (existsSync(version_file)) {
        const kept = readFileSync(version_file, "utf8").trim()
        const binaries_major = majorOf(tools, owner)
        if (kept !== binaries_major && !isRunning(data, tools, owner)) {
            console.info(
                `This checkout's Postgres data is from Postgres ${kept}, and its binaries are ${binaries_major}: making it again`
            )
            rmSync(data, { recursive: true, force: true })
        }
    }
    if (!existsSync(version_file)) {
        initialize(directory, data, tools, owner)
    }

    if (isRunning(data, tools, owner)) {
        rememberRunningPort(data)
    } else {
        const port = await portToUse()
        const started = run(
            tools.pg_ctl,
            [
                "start",
                `--pgdata=${data}`,
                `--log=${join(directory, "server.log")}`,
                "--wait",
                "--timeout=60",
                `--options=-p ${port} ${SETTINGS.join(" ")}`
            ],
            owner
        )
        // Another process may have started it at the same moment
        if (!started.ok && !isRunning(data, tools, owner)) {
            throw new Error(
                `This checkout's Postgres didn't start: ${started.output}\n${logTail(directory)}`
            )
        }
    }

    await makeAppDatabase()

    // A server that's been running without one gets its watch too.
    // Without it, it only runs longer than it needs to, so that doesn't stop
    // the start.
    try {
        await startIdleWatch(
            localDatabaseUrl("postgres"),
            data,
            join(directory, "server.log")
        )
    } catch (error) {
        console.error("This checkout's Postgres has no idle watch", { error })
    }
}

/** Stops this checkout's Postgres, if it's running, keeping its data. */
export function stopLocalServer() {
    const directory = localDirectory()
    const data = join(directory, "data")
    const owner = serverOwner()
    const tools = binaries(directory, owner)
    if (isRunning(data, tools, owner)) {
        const stopped = run(
            tools.pg_ctl,
            ["stop", `--pgdata=${data}`, "--mode=fast", "--wait"],
            owner
        )
        if (!stopped.ok) {
            throw new Error(
                `This checkout's Postgres didn't stop: ${stopped.output}`
            )
        }
    }
}

/** Applies the branch's migrations to the app's database on it. */
export async function migrateLocalDatabase() {
    await startLocalServer()
    // Imported here, so `start` and `url` don't load Drizzle, nor DBOS,
    // which it migrates too, and which is slow to load
    const { migrateDatabase } = await import("../migrate.ts")
    return await migrateDatabase(localDatabaseUrl())
}

// Who Postgres runs as: whoever this is, or a `postgres` user when this is
// root, since Postgres refuses to run as root
type Owner = { uid?: number; gid?: number }

function serverOwner(): Owner {
    if (process.getuid?.() !== 0) {
        return {}
    }
    if (!run("id", ["-u", "postgres"], {}).ok) {
        if (!run("getent", ["group", "postgres"], {}).ok) {
            required(run("groupadd", ["postgres"], {}))
        }
        required(run("useradd", ["-g", "postgres", "postgres"], {}))
    }
    return {
        uid: Number(required(run("id", ["-u", "postgres"], {}))),
        gid: Number(required(run("id", ["-g", "postgres"], {})))
    }
}

// The binaries `embedded-postgres` brought for this platform, as
// @embedded-postgres/<platform>-<arch>, one of its optional dependencies
function binaries(directory: string, owner: Owner) {
    const platform = `${process.platform}-${process.arch}`
    const embedded = createRequire(import.meta.url).resolve("embedded-postgres")
    const entry = (() => {
        try {
            return createRequire(embedded).resolve(
                `@embedded-postgres/${platform}`
            )
        } catch (error) {
            throw new Error(
                `There are no Postgres binaries for ${platform} in node_modules: run pnpm install on a Mac or on Linux`,
                { cause: error }
            )
        }
    })()
    const installed = join(dirname(entry), "..", "native")
    restoreSymlinks(installed)

    const native = (() => {
        if (
            owner.uid === undefined ||
            run(join(installed, "bin", "pg_ctl"), ["--version"], owner).ok
        ) {
            return installed
        } else {
            // As root, the `postgres` user may not reach node_modules (a
            // checkout under /root), so it gets a copy beside its data
            const copy = join(directory, "native")
            if (!existsSync(join(copy, "bin", "pg_ctl"))) {
                mkdirSync(directory, { recursive: true })
                cpSync(installed, copy, {
                    recursive: true,
                    verbatimSymlinks: true
                })
            }
            return copy
        }
    })()
    return {
        initdb: join(native, "bin", "initdb"),
        pg_ctl: join(native, "bin", "pg_ctl")
    }
}

// The package lists the libraries' symlinks in a file, since npm can't
// pack them, for its install script to make. pnpm runs no install script
// it hasn't been told to, so they're made here, once.
const symlinks_file = z.array(
    z.object({ source: z.string(), target: z.string() })
)

function restoreSymlinks(native: string) {
    const file = join(native, "pg-symlinks.json")
    if (!existsSync(file)) {
        return
    }
    // Its paths are from the package's folder
    const root = dirname(native)
    const symlinks = symlinks_file.parse(JSON.parse(readFileSync(file, "utf8")))
    for (const { source, target } of symlinks) {
        const link = join(root, target)
        if (lstatSync(link, { throwIfNoEntry: false }) === undefined) {
            symlinkSync(relative(dirname(link), join(root, source)), link)
        }
    }
}

// Makes the server's data, in a folder of its own that's then renamed into
// place, so a server only ever starts on a whole one, and two processes
// making it at once don't meet
function initialize(
    directory: string,
    data: string,
    tools: ReturnType<typeof binaries>,
    owner: Owner
) {
    mkdirSync(directory, { recursive: true })
    giveTo(directory, owner)
    const staging = mkdtempSync(join(directory, "initdb-"))
    giveTo(staging, owner)
    required(
        run(
            tools.initdb,
            [
                `--pgdata=${staging}`,
                "--username=postgres",
                "--auth=trust",
                "--encoding=UTF8",
                // Sorting text as production's en_US.utf8 does, through
                // the ICU the binaries carry, the same on a Mac and on
                // Linux, which may not have that locale
                "--locale-provider=icu",
                "--icu-locale=en-US",
                "--locale=C",
                "--no-instructions"
            ],
            owner
        )
    )
    if (existsSync(join(data, "PG_VERSION"))) {
        // Another process made it first
        rmSync(staging, { recursive: true, force: true })
    } else {
        renameSync(staging, data)
    }
}

function isRunning(
    data: string,
    tools: ReturnType<typeof binaries>,
    owner: Owner
) {
    return run(tools.pg_ctl, ["status", `--pgdata=${data}`], owner).ok
}

// The port a running server listens on is the fourth line of its
// postmaster.pid, which is the one to remember if the file says otherwise
function rememberRunningPort(data: string) {
    const lines = readFileSync(join(data, "postmaster.pid"), "utf8").split("\n")
    const port = lines[3]?.trim()
    if (port !== undefined && port !== "" && savedPort() !== Number(port)) {
        writeFileSync(portFile(), `${port}\n`)
    }
}

// The port it listened on last, kept while it's free, so a URL saved
// somewhere keeps working, or one the system says is free
async function portToUse() {
    const saved = savedPort()
    if (saved !== undefined && (await isFree(saved))) {
        return saved
    } else {
        const port = await freePort()
        writeFileSync(portFile(), `${port}\n`)
        return port
    }
}

function savedPort() {
    if (!existsSync(portFile())) {
        return undefined
    } else {
        const port = Number(readFileSync(portFile(), "utf8").trim())
        return Number.isInteger(port) && port > 0 ? port : undefined
    }
}

function isFree(port: number) {
    return new Promise<boolean>((resolve) => {
        const server = createServer()
        server.once("error", () => resolve(false))
        server.listen(port, "127.0.0.1", () => {
            server.close(() => resolve(true))
        })
    })
}

function freePort() {
    return new Promise<number>((resolve, reject) => {
        const server = createServer()
        server.once("error", reject)
        server.listen(0, "127.0.0.1", () => {
            const address = server.address()
            if (address === null || typeof address === "string") {
                server.close(() => reject(new Error("No free port")))
            } else {
                server.close(() => resolve(address.port))
            }
        })
    })
}

// The app's database, which initdb doesn't make
async function makeAppDatabase() {
    const client = new pg.Client({
        connectionString: localDatabaseUrl("postgres")
    })
    await client.connect()
    try {
        const { rowCount } = await client.query(
            "select 1 from pg_database where datname = $1",
            [LOCAL_DATABASE]
        )
        if (rowCount === 0) {
            await client.query(`create database "${LOCAL_DATABASE}"`)
        }
    } finally {
        await client.end()
    }
}

function logTail(directory: string) {
    const log = join(directory, "server.log")
    if (!existsSync(log)) {
        return ""
    } else {
        return readFileSync(log, "utf8").split("\n").slice(-20).join("\n")
    }
}

function giveTo(path: string, owner: Owner) {
    if (owner.uid !== undefined && owner.gid !== undefined) {
        chownSync(path, owner.uid, owner.gid)
    }
}

// A command run to its end, with what it printed
function run(command: string, args: string[], owner: Owner) {
    const options: SpawnSyncOptions = { ...owner, encoding: "utf8" }
    const result = spawnSync(command, args, options)
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim()
    return { ok: result.status === 0, output, error: result.error }
}

// The binaries' major version, as PG_VERSION names it: `18` of
// `pg_ctl (PostgreSQL) 18.4`
function majorOf(tools: ReturnType<typeof binaries>, owner: Owner) {
    const version = required(run(tools.pg_ctl, ["--version"], owner))
    const major = /\) (\d+)/.exec(version)?.[1]
    if (major === undefined) {
        throw new Error(`Postgres's version wasn't in "${version}"`)
    }
    return major
}

function required(result: ReturnType<typeof run>) {
    if (!result.ok) {
        throw new Error(result.output, { cause: result.error })
    } else {
        return result.output
    }
}

// Run as a script, not imported
if (fileURLToPath(import.meta.url) === process.argv[1]) {
    const [command, query] = process.argv.slice(2)
    try {
        switch (command) {
            case "start": {
                await startLocalServer()
                console.info("This checkout's Postgres is running", {
                    url: localDatabaseUrl()
                })
                break
            }
            case "stop": {
                stopLocalServer()
                console.info("This checkout's Postgres has stopped")
                break
            }
            case "url": {
                // Only the URL, for `$(…)`
                await startLocalServer()
                process.stdout.write(`${localDatabaseUrl()}\n`)
                break
            }
            case "migrate": {
                const { applied, total } = await migrateLocalDatabase()
                console.info("Migrations applied", { applied, total })
                break
            }
            case "sql": {
                if (query === undefined || query === "") {
                    throw new Error('Usage: pnpm database:sql "<query>"')
                }
                await startLocalServer()
                await readOnly(query)
                break
            }
            case "reset": {
                stopLocalServer()
                rmSync(localDirectory(), { recursive: true, force: true })
                const { total } = await migrateLocalDatabase()
                console.info("This checkout's Postgres is empty again", {
                    migrations: total
                })
                break
            }
            default: {
                throw new Error(
                    "Usage: node source/database/local/server.ts [start | stop | url | migrate | sql | reset]"
                )
            }
        }
    } catch (error) {
        console.error("This checkout's Postgres failed", { error })
        process.exit(1)
    }
}

// One query on the app's database, in a session that can't write, not even
// in a CTE, and its rows
async function readOnly(query: string) {
    const client = new pg.Client({
        connectionString: localDatabaseUrl(),
        options: "-c default_transaction_read_only=on"
    })
    await client.connect()
    try {
        const { rows, rowCount } = await client.query(query)
        if (rows.length === 0) {
            console.info("No rows", { count: rowCount })
        } else {
            console.table(rows)
        }
    } finally {
        await client.end()
    }
}
