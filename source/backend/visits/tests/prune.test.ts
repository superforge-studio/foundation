import { expect, test } from "vitest"
import { analytics_events, analytics_visits } from "@/database/schema"
import { testDatabase } from "@/database/tests/support/database"
import { DAY } from "@/utilities/primitives/durations"
import { SETTINGS, TEMPLATE_SETTINGS } from "@/utilities/settings"
import {
    deleteOldEvents,
    forgetOldAddresses,
    KEEP_EVENTS_FOR,
    KEEP_IP_ADDRESSES_FOR,
    KEEP_VISITS_FOR,
    pruneAnalytics
} from "../prune"

// How long the analytics is kept: the events and the visitors' IP
// addresses for a while, the visits for longer, and any of them for good
// when a copy says so

// A remembered visitor's visit that started `days` ago, with their
// address, one event then, and a server's event of the same age
async function visitFrom(
    database: Awaited<ReturnType<typeof testDatabase>>,
    days: number
) {
    const at = new Date(Date.now() - days * DAY)
    const [visit] = await database
        .insert(analytics_visits)
        .values({
            visitor_id: `visitor-${days}`,
            anonymous: false,
            ip_address: "203.0.113.7",
            started_at: at,
            ended_at: at
        })
        .returning()
    await database.insert(analytics_events).values([
        {
            source: "browser",
            name: "view",
            visit_id: visit?.id,
            visitor_id: `visitor-${days}`,
            path: "/",
            occurred_at: at
        },
        { source: "server", name: "signed-up", occurred_at: at }
    ])
}

// How many days old each visit is, each one that still has its address,
// and each event, oldest first
async function ages(database: Awaited<ReturnType<typeof testDatabase>>) {
    const days = (at: Date) => Math.round((Date.now() - at.getTime()) / DAY)
    const visits = await database.select().from(analytics_visits)
    const events = await database.select().from(analytics_events)
    return {
        visits: visits.map((visit) => days(visit.started_at)).sort(descending),
        addresses: visits
            .filter((visit) => visit.ip_address !== null)
            .map((visit) => days(visit.started_at))
            .sort(descending),
        events: events.map((event) => days(event.occurred_at)).sort(descending)
    }
}

function descending(one: number, other: number) {
    return other - one
}

test("events and addresses go after 90 days and visits after 25 months, as the template ships", () => {
    expect(TEMPLATE_SETTINGS.keep_events_for).toBe(90 * DAY)
    expect(TEMPLATE_SETTINGS.keep_ip_addresses_for).toBeUndefined()
    expect(TEMPLATE_SETTINGS.keep_visits_for).toBe(760 * DAY)
})

test("they're kept as this app's settings say, the addresses as long as the events unless they say", () => {
    expect(KEEP_EVENTS_FOR).toBe(SETTINGS.keep_events_for)
    expect(KEEP_IP_ADDRESSES_FOR).toBe(
        SETTINGS.keep_ip_addresses_for ?? SETTINGS.keep_events_for
    )
    expect(KEEP_VISITS_FOR).toBe(SETTINGS.keep_visits_for)
})

// As the template ships, whatever this app's settings say
const SHIPPED = {
    events: 90 * DAY,
    addresses: 90 * DAY,
    visits: 760 * DAY
}

test("deletes the events and blanks the addresses older than they're kept, and leaves their visits", async () => {
    const database = await testDatabase()
    for (const days of [1, 89, 91, 400]) {
        await visitFrom(database, days)
    }

    expect(await pruneAnalytics(database, SHIPPED)).toEqual({
        events: 4,
        addresses: 2,
        visits: 0
    })
    expect(await ages(database)).toEqual({
        visits: [400, 91, 89, 1],
        addresses: [89, 1],
        events: [89, 89, 1, 1]
    })
    // Nothing left to delete or blank
    expect(await pruneAnalytics(database, SHIPPED)).toEqual({
        events: 0,
        addresses: 0,
        visits: 0
    })
})

test("keeps the addresses as long as a copy says, apart from the events", async () => {
    const database = await testDatabase()
    for (const days of [1, 31, 91]) {
        await visitFrom(database, days)
    }

    expect(
        await pruneAnalytics(database, {
            events: "forever",
            addresses: 30 * DAY
        })
    ).toEqual({ events: 0, addresses: 2, visits: 0 })
    expect(await ages(database)).toEqual({
        visits: [91, 31, 1],
        addresses: [1],
        events: [91, 91, 31, 31, 1, 1]
    })
})

test("deletes the visits older than they're kept, with any events they still have", async () => {
    const database = await testDatabase()
    for (const days of [1, 759, 761]) {
        await visitFrom(database, days)
    }

    // The events kept for good: the old visit takes its own with it, and
    // the server's of that age stays
    expect(await pruneAnalytics(database, { events: "forever" })).toEqual({
        events: 0,
        addresses: 2,
        visits: 1
    })
    expect(await ages(database)).toEqual({
        visits: [759, 1],
        addresses: [1],
        events: [761, 759, 759, 1, 1]
    })
})

test("keeps for good what a copy says to", async () => {
    const database = await testDatabase()
    await visitFrom(database, 5000)
    expect(
        await pruneAnalytics(database, {
            events: "forever",
            addresses: "forever",
            visits: "forever"
        })
    ).toEqual({ events: 0, addresses: 0, visits: 0 })
    expect(await ages(database)).toEqual({
        visits: [5000],
        addresses: [5000],
        events: [5000, 5000]
    })
})

test("deletes a batch at a time, the oldest left for the next", async () => {
    const database = await testDatabase()
    for (const days of [100, 200, 300]) {
        await visitFrom(database, days)
    }
    expect(await deleteOldEvents(database, { keep: 90 * DAY, limit: 4 })).toBe(
        4
    )
    expect(await deleteOldEvents(database, { keep: 90 * DAY, limit: 4 })).toBe(
        2
    )
    expect(await deleteOldEvents(database, { keep: 90 * DAY, limit: 4 })).toBe(
        0
    )
})

test("blanks a batch of addresses at a time, the oldest left for the next", async () => {
    const database = await testDatabase()
    for (const days of [100, 200, 300]) {
        await visitFrom(database, days)
    }
    const forget = () =>
        forgetOldAddresses(database, { keep: 90 * DAY, limit: 2 })
    expect(await forget()).toBe(2)
    expect(await forget()).toBe(1)
    expect(await forget()).toBe(0)
    expect((await ages(database)).visits).toEqual([300, 200, 100])
})
