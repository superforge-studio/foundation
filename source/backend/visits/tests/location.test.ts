import { gzipSync } from "node:zlib"
import { expect, test, vi } from "vitest"
import { HOUR, WEEK } from "@/utilities/primitives/durations"
import { GDPR_COUNTRIES, locator } from "../location"

// Placing a visitor by their IP address: which of DB-IP's databases is
// downloaded, when, and what a lookup makes of what it holds. No test
// reaches DB-IP: `send` stands in for `fetch`, and `open` for MaxMind's
// reader, answering records shaped as each database's are (read from
// November 2026's on 2026-11-21).

// What each database holds for an address, the fields a lookup reads
const COUNTRY_LITE = {
    country: { iso_code: "DE", names: { en: "Germany" } }
}
const CITY_LITE = {
    country: { iso_code: "US", names: { en: "United States" } },
    subdivisions: [{ names: { en: "Texas" } }],
    city: { names: { en: "Austin" } }
}

// A clock a test moves, and DB-IP answering `status` for each month's
// file, with every address it was asked for
function setup(
    database: Parameters<typeof locator>[0]["database"],
    answers: Record<string, number> = {},
    held: typeof COUNTRY_LITE | typeof CITY_LITE = COUNTRY_LITE
) {
    let time = Date.UTC(2026, 10, 21, 12)
    const asked: string[] = []
    const located = locator({
        database,
        now: () => time,
        send: async (input) => {
            const address = String(input)
            asked.push(address)
            const month = /(\d{4}-\d{2})\.mmdb\.gz$/.exec(address)?.[1] ?? ""
            const status = answers[month] ?? 200
            return new Response(
                status === 200 ? gzipSync("a database") : null,
                {
                    status
                }
            )
        },
        open: () => ({
            get: (ip) => (ip === "203.0.113.9" ? held : null)
        })
    })
    return {
        ...located,
        asked,
        wait(milliseconds: number) {
            time += milliseconds
        }
    }
}

test("with no database named, no visitor is placed and nothing is downloaded", () => {
    const { locate, asked, loading } = setup(null)
    expect(locate("203.0.113.9")).toBeNull()
    expect(loading()).toBeNull()
    expect(asked).toEqual([])
})

test("the first lookup starts the download and doesn't wait for it, and the next ones are placed", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const { locate, asked, loading } = setup("dbip-country-lite")

    expect(locate("203.0.113.9")).toBeNull()
    await loading()
    expect(asked).toEqual([
        "https://download.db-ip.com/free/dbip-country-lite-2026-11.mmdb.gz"
    ])
    expect(locate("203.0.113.9")).toEqual({
        country: "DE",
        region: null,
        city: null
    })

    // An address the database has no place for, like a private network's,
    // and what isn't an address
    expect(locate("10.0.0.1")).toBeNull()
    expect(locate("not an address")).toBeNull()
    expect(asked).toHaveLength(1)
})

test("starting it begins the download before any visitor arrives", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const { locate, start, asked, loading } = setup("dbip-country-lite")
    start()
    await loading()
    expect(asked).toHaveLength(1)
    expect(locate("203.0.113.9")?.country).toBe("DE")

    // And nothing, with no database named
    const none = setup(null)
    none.start()
    expect(none.loading()).toBeNull()
})

test("the city database places a visitor by region and city too", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const { locate, asked, loading } = setup("dbip-city-lite", {}, CITY_LITE)
    locate("203.0.113.9")
    await loading()

    expect(asked).toEqual([
        "https://download.db-ip.com/free/dbip-city-lite-2026-11.mmdb.gz"
    ])
    expect(locate("203.0.113.9")).toEqual({
        country: "US",
        region: "Texas",
        city: "Austin"
    })
})

test("before this month's database is out, last month's is loaded", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const { locate, asked, loading } = setup("dbip-country-lite", {
        "2026-11": 404
    })
    locate("203.0.113.9")
    await loading()

    expect(asked).toEqual([
        "https://download.db-ip.com/free/dbip-country-lite-2026-11.mmdb.gz",
        "https://download.db-ip.com/free/dbip-country-lite-2026-10.mmdb.gz"
    ])
    expect(locate("203.0.113.9")?.country).toBe("DE")
})

test("a download that fails is tried again an hour later, and no sooner", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const { locate, asked, loading, wait } = setup("dbip-country-lite", {
        "2026-11": 503,
        "2026-10": 503
    })
    locate("203.0.113.9")
    await loading()
    expect(asked).toHaveLength(2)

    wait(HOUR - 1)
    expect(locate("203.0.113.9")).toBeNull()
    expect(loading()).toBeNull()
    expect(asked).toHaveLength(2)

    wait(2)
    locate("203.0.113.9")
    await loading()
    expect(asked).toHaveLength(4)
})

test("a loaded database is downloaded again a week later, and places visitors meanwhile", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const { locate, asked, loading, wait } = setup("dbip-country-lite")
    locate("203.0.113.9")
    await loading()

    wait(WEEK - 1)
    expect(locate("203.0.113.9")?.country).toBe("DE")
    expect(loading()).toBeNull()

    wait(2)
    expect(locate("203.0.113.9")?.country).toBe("DE")
    await loading()
    expect(asked).toHaveLength(2)
})

test("a download that throws is logged, and leaves the lookup placing no one", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {})
    const located = locator({
        database: "dbip-country-lite",
        send: async () => {
            throw new Error("No network")
        }
    })
    expect(located.locate("203.0.113.9")).toBeNull()
    await located.loading()
    expect(located.locate("203.0.113.9")).toBeNull()
    expect(logged).toHaveBeenCalledWith(
        "The location database didn't load",
        expect.objectContaining({ database: "dbip-country-lite" })
    )
})

test("GDPR applies in the EU's 27, the EEA's other three and the UK", () => {
    expect(GDPR_COUNTRIES.size).toBe(31)
    for (const country of ["DE", "FR", "IE", "IS", "LI", "NO", "GB"]) {
        expect(GDPR_COUNTRIES.has(country)).toBe(true)
    }
    for (const country of ["US", "CH", "CA"]) {
        expect(GDPR_COUNTRIES.has(country)).toBe(false)
    }
})

test("a download, or what it unzips to, past the most a database is, is refused rather than held", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {})
    for (const answer of [
        // Unzips to more than the most
        gzipSync(Buffer.alloc(64 * 1024)),
        // Is more than the most itself
        Buffer.alloc(16 * 1024)
    ]) {
        const opened: Buffer[] = []
        const located = locator({
            database: "dbip-country-lite",
            send: async () => new Response(answer),
            open: (file) => {
                opened.push(file)
                return { get: () => null }
            },
            largest: { download: 8 * 1024, unzipped: 32 * 1024 }
        })
        located.start()
        await located.loading()
        expect(opened).toEqual([])
    }
    expect(logged).toHaveBeenCalledWith(
        "The location database didn't load",
        expect.objectContaining({ database: "dbip-country-lite" })
    )
})
