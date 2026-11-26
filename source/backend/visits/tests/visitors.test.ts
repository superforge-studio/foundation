import { afterEach, expect, test, vi } from "vitest"
import { Storage } from "@/database/storage"
import { visitor_salt } from "@/database/storage/files"
import { memoryStore } from "@/database/tests/support/storage"
import { DAY } from "@/utilities/primitives/durations"
import { describeBrowser } from "../browsers"
import {
    anonymousVisitor,
    decideVisitor,
    networkOf,
    whomToRemember
} from "../visitors"

// Whom the site remembers, and the day's hash for a visitor it doesn't,
// with its salt in the bucket's one file

afterEach(() => {
    vi.useRealTimers()
})

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X)"

// The salt the bucket holds, as its file says
function keptSalt(files: ReturnType<typeof memoryStore>["files"]) {
    const file = files.get("visitor-salt/today.json")
    return file === undefined
        ? null
        : visitor_salt.parse(JSON.parse(new TextDecoder().decode(file.body)))
}

test("whom the site remembers, by its mode, the visitor's answer and their country", () => {
    // Everyone who hasn't declined, and nobody asked
    expect(whomToRemember("remember", "unasked", "DE")).toEqual({
        remembered: true,
        ask: false
    })
    expect(whomToRemember("remember", "declined", "US")).toEqual({
        remembered: false,
        ask: false
    })

    // Whoever accepted, and whoever hasn't answered asked
    expect(whomToRemember("ask", "unasked", "US")).toEqual({
        remembered: false,
        ask: true
    })
    expect(whomToRemember("ask", "given", "US")).toEqual({
        remembered: true,
        ask: false
    })
    expect(whomToRemember("ask", "declined", "US")).toEqual({
        remembered: false,
        ask: false
    })

    // As `ask` where GDPR applies, the EEA and the UK with it
    for (const country of ["DE", "NO", "GB"]) {
        expect(whomToRemember("ask-in-eu", "unasked", country)).toEqual({
            remembered: false,
            ask: true
        })
        expect(whomToRemember("ask-in-eu", "given", country)).toEqual({
            remembered: true,
            ask: false
        })
    }
    // As `remember` everywhere else
    expect(whomToRemember("ask-in-eu", "unasked", "US")).toEqual({
        remembered: true,
        ask: false
    })
    expect(whomToRemember("ask-in-eu", "declined", "US")).toEqual({
        remembered: false,
        ask: false
    })
    // A visitor the server can't place is asked, since the EU can't be
    // ruled out
    expect(whomToRemember("ask-in-eu", "unasked", null)).toEqual({
        remembered: false,
        ask: true
    })

    // Nobody, whatever they answered
    expect(whomToRemember("never", "given", "US")).toEqual({
        remembered: false,
        ask: false
    })
})

test("what the site decides of a visitor: never a bot, and anyone else as whomToRemember says, only under an ID", () => {
    const placed: string[] = []
    const locate = (ip: string) => {
        placed.push(ip)
        return { country: "DE", region: null, city: null }
    }
    const id = "0b9e8a36-5a8c-4c39-9d1c-2d6f6a1b7e10"
    const ip = "203.0.113.9"

    // A bot is never remembered or asked, and isn't placed
    expect(
        decideVisitor(locate, {
            mode: "remember",
            visitor: {
                id,
                consent: "given",
                ip,
                user_agent:
                    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
            }
        })
    ).toEqual({ browser: null, place: null, remembered_id: null, ask: false })
    expect(placed).toEqual([])

    // Anyone else is placed once, and remembered under their ID as
    // whomToRemember says by the place's country
    expect(
        decideVisitor(locate, {
            mode: "remember",
            visitor: { id, consent: "unasked", ip, user_agent: IPHONE }
        })
    ).toEqual({
        browser: describeBrowser(IPHONE),
        place: { country: "DE", region: null, city: null },
        remembered_id: id,
        ask: false
    })
    expect(placed).toEqual([ip])
    expect(
        decideVisitor(locate, {
            mode: "ask-in-eu",
            visitor: { id, consent: "unasked", ip, user_agent: IPHONE }
        })
    ).toMatchObject({ remembered_id: null, ask: true })

    // Only under an ID their cookie holds, or would
    expect(
        decideVisitor(locate, {
            mode: "remember",
            visitor: { id: null, consent: "given", ip, user_agent: IPHONE }
        })
    ).toMatchObject({ remembered_id: null, ask: false })
})

test("a visitor who isn't remembered is the same hash all day, by their network and their browser", async () => {
    const storage = new Storage(memoryStore().store)
    const hash = await anonymousVisitor(storage, {
        ip: "203.0.113.9",
        user_agent: IPHONE
    })
    expect(hash).toMatch(/^[\w-]{22}$/)
    expect(
        await anonymousVisitor(storage, {
            ip: "203.0.113.9",
            user_agent: IPHONE
        })
    ).toBe(hash)

    // Another address, or another browser, is another visitor
    expect(
        await anonymousVisitor(storage, {
            ip: "203.0.113.10",
            user_agent: IPHONE
        })
    ).not.toBe(hash)
    expect(
        await anonymousVisitor(storage, {
            ip: "203.0.113.9",
            user_agent: "Mozilla/5.0 (Macintosh)"
        })
    ).not.toBe(hash)
})

test("an IPv6 visitor counts by their /64, and an IPv4 address written as IPv6 as the IPv4 one", async () => {
    const storage = new Storage(memoryStore().store)
    const hashOf = (ip: string) =>
        anonymousVisitor(storage, { ip, user_agent: IPHONE })

    expect(await hashOf("2001:db8:1:2:aaaa::1")).toBe(
        await hashOf("2001:db8:1:2:bbbb::2")
    )
    expect(await hashOf("2001:db8:1:3::1")).not.toBe(
        await hashOf("2001:db8:1:2::1")
    )
    expect(await hashOf("::ffff:203.0.113.9")).toBe(await hashOf("203.0.113.9"))

    expect(networkOf("203.0.113.9")).toBe("203.0.113.9")
    expect(networkOf("2001:db8:1:2:aaaa::1")).toBe("2001:db8:1:2::/64")
    expect(networkOf("::ffff:203.0.113.9")).toBe("203.0.113.9")
    expect(networkOf("not an address")).toBeNull()
})

test("today's salt is one file in the bucket, which every process hashes with", async () => {
    const bucket = memoryStore()
    const visitor = { ip: "203.0.113.9", user_agent: IPHONE }
    const hash = await anonymousVisitor(new Storage(bucket.store), visitor)

    expect([...bucket.files.keys()]).toEqual(["visitor-salt/today.json"])
    expect(keptSalt(bucket.files)).toEqual({
        day: new Date().toISOString().slice(0, 10),
        salt: expect.stringMatching(/^[\w-]{43}$/)
    })
    // Another process, on the same bucket, makes the same hash
    expect(await anonymousVisitor(new Storage(bucket.store), visitor)).toBe(
        hash
    )
})

test("the next day's salt replaces today's, so yesterday's hash can't be made again", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-21T23:59:00Z"))
    const bucket = memoryStore()
    const storage = new Storage(bucket.store)
    const visitor = { ip: "203.0.113.9", user_agent: IPHONE }
    const today = await anonymousVisitor(storage, visitor)
    const first = keptSalt(bucket.files)
    expect(first?.day).toBe("2026-11-21")

    vi.setSystemTime(Date.now() + DAY)
    const tomorrow = await anonymousVisitor(storage, visitor)
    expect(tomorrow).not.toBe(today)
    expect([...bucket.files.keys()]).toEqual(["visitor-salt/today.json"])
    expect(keptSalt(bucket.files)?.day).toBe("2026-11-22")
    expect(keptSalt(bucket.files)?.salt).not.toBe(first?.salt)
})

test("a bucket that's down still counts the visitor, with a salt of the process's own, and says so", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {})
    const bucket = memoryStore()
    bucket.fail()
    const storage = new Storage(bucket.store)
    const visitor = { ip: "203.0.113.9", user_agent: IPHONE }

    const hash = await anonymousVisitor(storage, visitor)
    expect(hash).toMatch(/^[\w-]{22}$/)
    expect(await anonymousVisitor(storage, visitor)).toBe(hash)
    expect(bucket.files.size).toBe(0)
    expect(logged).toHaveBeenCalledWith(
        "The visitor salt couldn't be kept in the bucket, so this process uses its own today",
        expect.anything()
    )
})
