import { asc, eq } from "drizzle-orm"
import { expect, test } from "vitest"
import { analytics_events, analytics_visits, users } from "@/database/schema"
import { Storage } from "@/database/storage"
import { testDatabase } from "@/database/tests/support/database"
import { memoryStore } from "@/database/tests/support/storage"
import { DAY, HOUR, MINUTE, SECOND } from "@/utilities/primitives/durations"
import type { PageEvent } from "@/utilities/schemas/visits"
import type { Locate } from "../location"
import {
    EVENTS_A_VISIT,
    type PageVisit,
    recordEvents,
    recordVisit
} from "../record"

// What's kept of a visitor's page events, and of what the server says
// happened, in a database of the test's own: each event's visit, what a
// visit comes to, and who it's kept under

const IPHONE =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1"

const VISITOR = "2f1c8e64-7b5a-4f2e-9c3d-8a6b1e0f4d27"

const AUSTIN = { country: "US", region: "Texas", city: "Austin" }

// A database and a bucket of the test's own, with visitors placed by
// `locate`: nowhere, unless the test says
async function setup(locate: Locate = () => null) {
    return {
        database: await testDatabase(),
        storage: new Storage(memoryStore().store),
        locate
    }
}

// A page's event, this long ago
function event(
    name: string,
    ago: number,
    path = "/",
    properties: PageEvent["properties"] = {}
): PageEvent {
    return { name, at: Date.now() - ago, path, properties }
}

// A batch of a remembered visitor's, sent now, with anything in `visitor`
// in place of theirs
function batch(
    events: PageEvent[],
    visitor: Partial<PageVisit["visitor"]> = {},
    mode: PageVisit["mode"] = "remember"
): PageVisit {
    return {
        mode,
        visitor: {
            id: VISITOR,
            consent: "unasked",
            user_id: null,
            ip: "203.0.113.9",
            user_agent: IPHONE,
            ...visitor
        },
        sent_at: Date.now(),
        events
    }
}

// Everything kept: the visits, oldest first, and the events, in order
async function kept(database: Awaited<ReturnType<typeof testDatabase>>) {
    return {
        visits: await database
            .select()
            .from(analytics_visits)
            .orderBy(asc(analytics_visits.started_at)),
        events: await database
            .select()
            .from(analytics_events)
            .orderBy(asc(analytics_events.occurred_at))
    }
}

// A user to be logged in as
async function userNamed(
    database: Awaited<ReturnType<typeof testDatabase>>,
    email: string
) {
    const [user] = await database
        .insert(users)
        .values({ slug: email.split("@")[0] ?? email, email })
        .returning()
    if (user === undefined) {
        throw new Error("The test's user wasn't made")
    }
    return user
}

test("keeps a remembered visitor's events in a visit, with where they were and what they were on", async () => {
    const context = await setup(() => AUSTIN)
    const answer = await recordVisit(
        context,
        batch([event("view", 2 * SECOND, "/pricing", { title: "Pricing" })])
    )
    expect(answer).toEqual({ kept: 1, remembered: true, ask: false })

    const { visits, events } = await kept(context.database)
    expect(visits).toEqual([
        expect.objectContaining({
            visitor_id: VISITOR,
            anonymous: false,
            user_id: null,
            views: 1,
            clicks: 0,
            bounced: true,
            landing_path: "/pricing",
            exit_path: "/pricing",
            ip_address: "203.0.113.9",
            country: "US",
            region: "Texas",
            city: "Austin",
            device: "mobile",
            browser: "Safari",
            os: "iOS"
        })
    ])
    expect(events).toEqual([
        expect.objectContaining({
            source: "browser",
            name: "view",
            visit_id: visits[0]?.id,
            visitor_id: VISITOR,
            user_id: null,
            path: "/pricing",
            properties: { title: "Pricing" }
        })
    ])
    // The address is kept on the visit alone, and the User-Agent nowhere
    expect(JSON.stringify(events)).not.toContain("203.0.113.9")
    expect(JSON.stringify({ visits, events })).not.toContain("AppleWebKit")
})

test("a remembered visitor's address is kept as an address, and only when it is one", async () => {
    const context = await setup()
    const visitors = [
        { id: "visitor-v4-in-v6", ip: "::ffff:203.0.113.20" },
        { id: "visitor-v6", ip: "2001:db8::1" },
        { id: "visitor-zoned", ip: "fe80::1%eth0" },
        { id: "visitor-unknown", ip: "unknown" }
    ]
    for (const visitor of visitors) {
        await recordVisit(context, batch([event("view", MINUTE)], visitor))
    }

    const { visits } = await kept(context.database)
    const addresses = Object.fromEntries(
        visits.map((visit) => [visit.visitor_id, visit.ip_address])
    )
    expect(addresses).toEqual({
        "visitor-v4-in-v6": "203.0.113.20",
        "visitor-v6": "2001:db8::1",
        "visitor-zoned": null,
        "visitor-unknown": null
    })
})

test("a visit lasts until 30 minutes pass without an event", async () => {
    const context = await setup()
    await recordVisit(
        context,
        batch([
            event("view", 70 * MINUTE, "/"),
            event("view", 60 * MINUTE, "/pricing"),
            // 40 minutes on, so a new visit
            event("view", 20 * MINUTE, "/blog")
        ])
    )
    // 15 minutes after the last, in another batch: the same visit
    await recordVisit(context, batch([event("view", 5 * MINUTE, "/book")]))

    const { visits, events } = await kept(context.database)
    expect(
        visits.map((visit) => [
            visit.landing_path,
            visit.exit_path,
            visit.views
        ])
    ).toEqual([
        ["/", "/pricing", 2],
        ["/blog", "/book", 2]
    ])
    expect(events.map((each) => each.visit_id)).toEqual([
        visits[0]?.id,
        visits[0]?.id,
        visits[1]?.id,
        visits[1]?.id
    ])
    expect(
        (visits[0]?.ended_at.getTime() ?? 0) -
            (visits[0]?.started_at.getTime() ?? 0)
    ).toBe(10 * MINUTE)
})

test("a visit holds at most 5,000 events, and the next starts another", async () => {
    const context = await setup()
    // One short of the most, a millisecond apart
    await recordVisit(
        context,
        batch(
            Array.from({ length: EVENTS_A_VISIT - 1 }, (_, index) =>
                event("click", 10 * SECOND - index)
            )
        )
    )
    // The first of these fills it, and the second starts another
    await recordVisit(
        context,
        batch([event("click", 2 * SECOND), event("click", SECOND)])
    )
    // Which the next joins, as any visit's next event does
    await recordVisit(context, batch([event("view", 0, "/pricing")]))

    const { visits } = await kept(context.database)
    expect(visits.map((visit) => [visit.clicks, visit.views])).toEqual([
        [EVENTS_A_VISIT, 0],
        [1, 1]
    ])
})

test("a visit says where it came from, as its landing said, and whether it bounced", async () => {
    const context = await setup()
    await recordVisit(
        context,
        batch([
            event("view", 9 * MINUTE, "/", {
                referrer: "google.com",
                utm_source: "google",
                utm_medium: "cpc",
                utm_campaign: "spring",
                utm_term: "plumber",
                utm_content: "headline-b",
                gclid: "abc123"
            }),
            event("click", 8 * MINUTE, "/", { target: "book-a-call" }),
            event("leave", 7 * MINUTE, "/", { scroll: 80, visible_ms: 90_000 }),
            // A later page's campaign isn't where the visit came from
            event("view", 7 * MINUTE, "/pricing", { utm_source: "newsletter" }),
            event("error", 6 * MINUTE, "/pricing", { message: "Oops" })
        ])
    )
    // Another visitor, who views one page from a Meta ad and clicks nothing
    await recordVisit(
        context,
        batch([event("view", 5 * MINUTE, "/offer", { fbclid: "xyz" })], {
            id: "9d0c2c1e-55a1-4c1a-8f0e-0a7d5f1b2c3d"
        })
    )

    const { visits } = await kept(context.database)
    expect(visits).toEqual([
        expect.objectContaining({
            views: 2,
            clicks: 1,
            bounced: false,
            landing_path: "/",
            exit_path: "/pricing",
            referrer: "google.com",
            utm_source: "google",
            utm_medium: "cpc",
            utm_campaign: "spring",
            utm_term: "plumber",
            utm_content: "headline-b",
            ad_network: "google"
        }),
        expect.objectContaining({
            views: 1,
            clicks: 0,
            bounced: true,
            landing_path: "/offer",
            referrer: null,
            utm_source: null,
            ad_network: "meta"
        })
    ])
})

test("events that arrive late are worked into the visit they belong to", async () => {
    const context = await setup()
    await recordVisit(context, batch([event("view", 10 * MINUTE, "/pricing")]))
    // The landing, which the page sent after
    await recordVisit(
        context,
        batch([event("view", 20 * MINUTE, "/", { referrer: "example.org" })])
    )

    const { visits } = await kept(context.database)
    expect(visits).toEqual([
        expect.objectContaining({
            views: 2,
            landing_path: "/",
            exit_path: "/pricing",
            referrer: "example.org"
        })
    ])
})

test("an event's time is corrected for the browser's clock, and one a week old is dropped", async () => {
    const context = await setup()
    // A browser whose clock runs an hour ahead
    const sent_at = Date.now() + HOUR
    const answer = await recordVisit(context, {
        ...batch([]),
        sent_at,
        events: [
            {
                name: "view",
                at: sent_at - 2 * SECOND,
                path: "/",
                properties: {}
            },
            // After the batch was sent, by its own clock: kept as now
            { name: "click", at: sent_at + MINUTE, path: "/", properties: {} },
            {
                name: "view",
                at: sent_at - 8 * DAY,
                path: "/old",
                properties: {}
            }
        ]
    })
    expect(answer.kept).toBe(2)

    const { events } = await kept(context.database)
    expect(events.map((each) => each.name)).toEqual(["view", "click"])
    const [view, click] = events.map((each) => each.occurred_at.getTime())
    expect(Math.abs((view ?? 0) - (Date.now() - 2 * SECOND))).toBeLessThan(
        5 * SECOND
    )
    expect(click ?? 0).toBeLessThanOrEqual(Date.now())

    // A batch with nothing left to keep is still answered
    expect(
        await recordVisit(context, batch([event("view", 8 * DAY, "/old")]))
    ).toEqual({ kept: 0, remembered: true, ask: false })
})

test("a visitor who isn't remembered is kept under the day's hash, with no user or address", async () => {
    const context = await setup()
    const ada = await userNamed(context.database, "ada@example.com")
    const answer = await recordVisit(
        context,
        batch(
            [event("view", MINUTE), event("view", 30 * SECOND, "/pricing")],
            { id: null, user_id: ada.id },
            "never"
        )
    )
    expect(answer).toEqual({ kept: 2, remembered: false, ask: false })

    const { visits, events } = await kept(context.database)
    expect(visits).toEqual([
        expect.objectContaining({
            visitor_id: expect.stringMatching(/^[\w-]{22}$/),
            anonymous: true,
            user_id: null,
            ip_address: null,
            views: 2
        })
    ])
    expect(JSON.stringify({ visits, events })).not.toContain("203.0.113.9")
    expect(events.map((each) => each.user_id)).toEqual([null, null])
    expect(events.map((each) => each.visitor_id)).toEqual([
        visits[0]?.visitor_id,
        visits[0]?.visitor_id
    ])
})

test("a visitor who declined is asked nothing more, and one who hasn't answered is asked", async () => {
    const context = await setup()
    expect(
        await recordVisit(
            context,
            batch([event("view", MINUTE)], { consent: "declined" }, "ask")
        )
    ).toEqual({ kept: 1, remembered: false, ask: false })
    expect(
        await recordVisit(
            context,
            batch([event("view", MINUTE)], { ip: "203.0.113.10" }, "ask")
        )
    ).toEqual({ kept: 1, remembered: false, ask: true })
    expect(
        await recordVisit(
            context,
            batch(
                [event("view", MINUTE)],
                { consent: "given", ip: "203.0.113.11" },
                "ask"
            )
        )
    ).toEqual({ kept: 1, remembered: true, ask: false })

    // Only the one who gave their consent is kept with their address
    const { visits } = await kept(context.database)
    expect(
        visits.map((visit) => visit.ip_address).filter((ip) => ip !== null)
    ).toEqual(["203.0.113.11"])
})

test("a visitor who logs in during a visit is on it from then on", async () => {
    const context = await setup()
    const ada = await userNamed(context.database, "ada@example.com")
    await recordVisit(context, batch([event("view", 5 * MINUTE, "/login")]))
    await recordVisit(
        context,
        batch([event("view", MINUTE, "/admin")], { user_id: ada.id })
    )

    const { visits, events } = await kept(context.database)
    expect(visits).toHaveLength(1)
    expect(visits[0]?.user_id).toBe(ada.id)
    expect(events.map((each) => each.user_id)).toEqual([null, ada.id])
})

test("two batches of one visitor's that arrive together join one visit", async () => {
    const context = await setup()
    await Promise.all([
        recordVisit(context, batch([event("view", 2 * MINUTE, "/")])),
        recordVisit(context, batch([event("view", MINUTE, "/pricing")])),
        recordVisit(context, batch([event("click", 30 * SECOND, "/pricing")]))
    ])

    const { visits } = await kept(context.database)
    expect(visits).toEqual([
        expect.objectContaining({ views: 2, clicks: 1, bounced: false })
    ])
})

test("a bot's events, and a browser's that doesn't say what it is, are answered and dropped", async () => {
    const context = await setup()
    for (const user_agent of [
        "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        ""
    ]) {
        expect(
            await recordVisit(
                context,
                batch([event("view", MINUTE)], { user_agent })
            )
        ).toEqual({ kept: 0, remembered: false, ask: false })
    }
    expect(await kept(context.database)).toEqual({ visits: [], events: [] })
})

test("keeps what the server says happened, with who it's about and no visit", async () => {
    const { database } = await setup()
    const ada = await userNamed(database, "ada@example.com")
    const at = new Date(Date.now() - HOUR)
    const count = await recordEvents(database, [
        { name: "signed-up", user_id: ada.id, visitor_id: VISITOR },
        {
            name: "booked-a-call",
            at,
            path: "/book",
            properties: { plan: "monthly", seats: 3 }
        }
    ])
    expect(count).toBe(2)

    const { visits, events } = await kept(database)
    expect(visits).toEqual([])
    expect(events).toEqual([
        expect.objectContaining({
            source: "server",
            name: "booked-a-call",
            visit_id: null,
            visitor_id: null,
            user_id: null,
            path: "/book",
            properties: { plan: "monthly", seats: 3 },
            occurred_at: at
        }),
        expect.objectContaining({
            source: "server",
            name: "signed-up",
            visit_id: null,
            visitor_id: VISITOR,
            user_id: ada.id,
            path: null,
            properties: {}
        })
    ])
})

test("an event that isn't one throws, and none of its call is kept", async () => {
    const { database } = await setup()
    await expect(
        recordEvents(database, [{ name: "signed-up" }, { name: "Signed Up" }])
    ).rejects.toThrow()
    expect((await kept(database)).events).toEqual([])
})

test("removing a user leaves their visits and events, without them", async () => {
    const context = await setup()
    const ada = await userNamed(context.database, "ada@example.com")
    await recordVisit(
        context,
        batch([event("view", MINUTE)], { user_id: ada.id })
    )
    await recordEvents(context.database, [
        { name: "signed-up", user_id: ada.id }
    ])
    await context.database.delete(users).where(eq(users.id, ada.id))

    const { visits, events } = await kept(context.database)
    expect(visits.map((visit) => visit.user_id)).toEqual([null])
    expect(events.map((each) => each.user_id)).toEqual([null, null])
})
