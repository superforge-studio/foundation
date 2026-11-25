import { isIP } from "node:net"
import { promisify } from "node:util"
import { gunzip } from "node:zlib"
import { type CityResponse, Reader } from "maxmind"
import { z } from "zod"
import { HOUR, WEEK } from "@/utilities/primitives/durations"

// Where a visitor is, from their IP address, in one of DB-IP's free
// databases, which the server downloads itself and holds in memory:
// MaxMind's format, updated monthly, and licensed CC BY 4.0, so whatever
// shows a place credits DB-IP (`LOCATION_CREDIT` in utilities/visitors.ts).
// Nothing is asked of any service as a visitor arrives, and no visitor's
// address leaves the server.
//
// Which database is `LOCATION_DATABASE` on the app's service
// (.railway/railway.ts), so it's loaded only on Railway, never in a dev
// server, the tests or CI, where every visitor's place is unknown:
//
// | `LOCATION_DATABASE`  | Places a visitor by     | Download | In memory |
// | -------------------- | ----------------------- | -------- | --------- |
// | `dbip-country-lite`  | Country, as it ships    | 4 MB     | 9 MB      |
// | `dbip-city-lite`     | Country, region, city   | 60 MB    | 120 MB    |
//
// (Country Lite read on 2026-11-21. City Lite's are Superforge Infra's,
// which ran it.)

const unzip = promisify(gunzip)

// The most a download, and what it unzips to, may be: about three times
// the largest database's (the table above), so a month that grows still
// loads, and a file that's wrong, or never ends, is refused rather than
// filling the server's memory
const LARGEST_DOWNLOAD = 200 * 1024 * 1024
const LARGEST_UNZIPPED = 400 * 1024 * 1024

/** The databases the server can place a visitor with (the table above). */
export const LOCATION_DATABASES = [
    "dbip-country-lite",
    "dbip-city-lite"
] as const
const location_database = z.enum(LOCATION_DATABASES)
export type LocationDatabase = z.infer<typeof location_database>

/** Where a visitor was, by their IP address. */
export type Place = {
    /** ISO 3166-1, like `US` */
    country: string
    /** Its name in English, like `Texas`: null with the country database */
    region: string | null
    /** Its name in English, like `Austin`: null with the country database */
    city: string | null
}

/** What places a visitor, on `context.var.locate`: `locate`, or a test's own. */
export type Locate = (ip: string) => Place | null

/**
 * The countries where GDPR applies, or the UK's own version of it: the
 * EU's 27, the EEA's other three (Iceland, Liechtenstein, Norway), and the
 * UK.
 */
export const GDPR_COUNTRIES: ReadonlySet<string> = new Set([
    "AT",
    "BE",
    "BG",
    "CY",
    "CZ",
    "DE",
    "DK",
    "EE",
    "ES",
    "FI",
    "FR",
    "GR",
    "HR",
    "HU",
    "IE",
    "IT",
    "LT",
    "LU",
    "LV",
    "MT",
    "NL",
    "PL",
    "PT",
    "RO",
    "SE",
    "SI",
    "SK",
    "IS",
    "LI",
    "NO",
    "GB"
])

// What a lookup reads of a database's record for an address: the country
// database's has the country alone
type Found = {
    country?: { iso_code?: string }
    subdivisions?: { names: { en?: string } }[]
    city?: { names: { en?: string } }
}

/** A downloaded database, open: what it has for an address, if anything. */
type OpenDatabase = { get(ip: string): Found | null }

/**
 * A database, loaded, refreshed and read. `appLocate()` makes the
 * server's; a test makes its own, with `send` in `fetch`'s place, its own
 * clock, and `open` in place of MaxMind's reader.
 */
export function locator({
    database,
    send = fetch,
    now = Date.now,
    open = (file) => new Reader<CityResponse>(file),
    largest = { download: LARGEST_DOWNLOAD, unzipped: LARGEST_UNZIPPED }
}: {
    /** Which to load, or null to load none and place no one */
    database: LocationDatabase | null
    send?: typeof fetch
    now?: () => number
    open?: (file: Buffer) => OpenDatabase
    /** The most a download, and what it unzips to, may be, in bytes */
    largest?: { download: number; unzipped: number }
}) {
    // The database once loaded, and when; and when a load was last tried,
    // so a failing download is tried again at most once an hour
    let loaded: { reader: OpenDatabase; at: number } | null = null
    let tried_at: number | null = null
    let loading: Promise<void> | null = null

    // Downloads this month's database, or last month's when this month's
    // isn't out yet, and holds it. One that fails leaves the last one
    // loaded.
    async function load(name: LocationDatabase) {
        const today = new Date(now())
        const months = [0, 1].map((back) =>
            new Date(
                Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - back, 1)
            )
                .toISOString()
                .slice(0, "yyyy-mm".length)
        )
        for (const month of months) {
            const address = `https://download.db-ip.com/free/${name}-${month}.mmdb.gz`
            try {
                const response = await send(address)
                if (response.ok) {
                    const file = await unzip(
                        await capped(response, largest.download),
                        { maxOutputLength: largest.unzipped }
                    )
                    loaded = { reader: open(file), at: now() }
                    console.info("The location database is loaded", {
                        database: name,
                        month
                    })
                    return
                } else {
                    console.info("The location database isn't there", {
                        database: name,
                        month,
                        status: response.status
                    })
                }
            } catch (error) {
                console.error("The location database didn't load", {
                    database: name,
                    month,
                    error
                })
            }
        }
    }

    // Starts a download when none is loaded, or the one loaded is a week
    // old, unless one is under way or was tried within the hour
    function refresh(name: LocationDatabase) {
        const stale = loaded === null || now() - loaded.at > WEEK
        const due = tried_at === null || now() - tried_at > HOUR
        if (stale && due && loading === null) {
            tried_at = now()
            loading = load(name).finally(() => {
                loading = null
            })
        }
    }

    /**
     * Where `ip` is, or null when the server can't tell: an address on a
     * private network, one the database has no place for, or any while the
     * database isn't loaded. A lookup never waits for the download: one
     * with none loaded starts it, and one a week later starts it again.
     */
    function locate(ip: string): Place | null {
        if (database === null) {
            return null
        }
        refresh(database)
        if (loaded === null || isIP(ip) === 0) {
            return null
        }

        const found = loaded.reader.get(ip)
        const country = found?.country?.iso_code
        if (country === undefined) {
            return null
        } else {
            return {
                country,
                region: found?.subdivisions?.[0]?.names.en ?? null,
                city: found?.city?.names.en ?? null
            }
        }
    }

    return {
        locate,
        /** Starts the download, without waiting for a first lookup to */
        start() {
            if (database !== null) {
                refresh(database)
            }
        },
        /** The load in flight, if there is one: for a test to wait on */
        loading: () => loading
    }
}

// A response's body, read no further than `most` bytes, which it throws
// past
async function capped(response: Response, most: number) {
    const reader = response.body?.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    while (reader !== undefined) {
        const { done, value } = await reader.read()
        if (done) {
            break
        }
        size += value.length
        if (size > most) {
            await reader.cancel()
            throw new Error(`The download is larger than ${most} bytes`)
        }
        chunks.push(value)
    }
    return Buffer.concat(chunks)
}

let shared: ReturnType<typeof locator> | undefined

/**
 * The server's lookup, made the first time it's asked for, with the
 * database `LOCATION_DATABASE` names: none without it, or with a name
 * that isn't one of `LOCATION_DATABASES`, which is logged. Its download
 * starts at once: the API's first request is Railway's healthcheck, so the
 * database is usually loaded before a deployment takes its first visitor.
 */
export function appLocate(): Locate {
    if (shared === undefined) {
        const named = process.env.LOCATION_DATABASE
        const parsed = location_database.safeParse(named)
        if (named !== undefined && !parsed.success) {
            console.error(
                "LOCATION_DATABASE isn't a database the server knows, so no visitor is placed",
                { named, known: LOCATION_DATABASES }
            )
        }
        shared = locator({ database: parsed.success ? parsed.data : null })
        shared.start()
    }
    return shared.locate
}
