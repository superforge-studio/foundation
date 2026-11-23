import { createHash, randomBytes } from "node:crypto"
import { isIP, isIPv4, isIPv6 } from "node:net"
import type { Storage } from "@/database/storage"
import type { VisitorConsent } from "@/utilities/schemas/visits"
import type { VisitorMode } from "@/utilities/visitors"
import { GDPR_COUNTRIES } from "./location"

// Who a page's visitor is: whether the site remembers them, by its mode,
// their answer and their country, and the day's hash for one it doesn't.
// README.md has the rules.

/** What a visitor answered the banner, or `unasked` before they have. */
export type Consent = VisitorConsent | "unasked"

/**
 * Whether the site remembers this visitor, by its `mode`, what they
 * answered and their country (null when the server can't tell), and
 * whether the page asks them. `ask-in-eu` asks where GDPR applies, and
 * where the country is unknown, since it can't be ruled out.
 */
export function whomToRemember(
    mode: VisitorMode,
    consent: Consent,
    country: string | null
) {
    if (mode === "never") {
        return { remembered: false, ask: false }
    }
    const asks =
        mode === "ask" ||
        (mode === "ask-in-eu" &&
            (country === null || GDPR_COUNTRIES.has(country)))
    if (asks) {
        return { remembered: consent === "given", ask: consent === "unasked" }
    } else {
        return { remembered: consent !== "declined", ask: false }
    }
}

// Each bucket's salt for the day, so a visit's hash costs no read once the
// day's is known. Keyed by the bucket, which each test has its own of.
const salts = new WeakMap<Storage, { day: string; salt: string }>()

/**
 * The day's hash for a visitor the site doesn't remember: of their network
 * (an IPv6 address's /64, which a phone moves around in) and their
 * User-Agent, with today's salt, so they count as one visitor today and
 * can't be matched to anyone after it. Neither the address nor the
 * User-Agent is kept.
 */
export async function anonymousVisitor(
    storage: Storage,
    visitor: { ip: string; user_agent: string }
) {
    const salt = await todaysSalt(storage)
    return createHash("sha256")
        .update(
            [
                salt,
                networkOf(visitor.ip) ?? visitor.ip,
                visitor.user_agent
            ].join("\n")
        )
        .digest("base64url")
        .slice(0, 22)
}

// Today's salt (UTC), from the bucket's one file (`Storage.visitor_salt`):
// made by whichever call needs it first, in place of the day before's, so
// every process hashes with the same one, and yesterday's is gone. Two
// processes that make today's at the same moment each read back whichever
// the bucket kept, so they agree but for a few milliseconds' window, which
// would count a visitor twice that day.
async function todaysSalt(storage: Storage) {
    const day = new Date().toISOString().slice(0, "yyyy-mm-dd".length)
    const known = salts.get(storage)
    if (known?.day === day) {
        return known.salt
    }
    const todays = await keptSalt(storage, day).catch((error: unknown) => {
        // A bucket that can't be reached costs the count its precision, not
        // the visit: this process hashes with a salt of its own for the
        // day, so a visitor another process sees counts again
        console.error(
            "The visitor salt couldn't be kept in the bucket, so this process uses its own today",
            { error }
        )
        return { day, salt: newSalt() }
    })
    salts.set(storage, todays)
    return todays.salt
}

// The bucket's salt for `day`: the one it has, or a new one in its place
async function keptSalt(storage: Storage, day: string) {
    const kept = await storage.visitor_salt.get({})
    if (kept?.day === day) {
        return kept
    } else {
        await storage.visitor_salt.put({}, { day, salt: newSalt() })
        const settled = await storage.visitor_salt.get({})
        if (settled?.day === day) {
            return settled
        } else {
            throw new Error("Today's visitor salt vanished as it was made")
        }
    }
}

function newSalt() {
    return randomBytes(32).toString("base64url")
}

/**
 * A remembered visitor's IP address as their visit keeps it: an IPv4 one
 * written as IPv6 (`::ffff:203.0.113.9`) as the IPv4 one. Null when it
 * isn't an address Postgres's `inet` takes, like one with a zone
 * (`fe80::1%eth0`), which is only this computer's.
 */
export function addressToKeep(ip: string) {
    const unmapped = ip.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, "")
    if (unmapped.includes("%") || isIP(unmapped) === 0) {
        return null
    } else {
        return unmapped
    }
}

/**
 * The network an IP address counts as: an IPv4 address as it is, an IPv6
 * one as its /64, and an IPv4 one written as IPv6 (`::ffff:203.0.113.9`)
 * as the IPv4 one. Null when it isn't an address.
 */
export function networkOf(ip: string) {
    if (isIPv4(ip)) {
        return ip
    } else if (isIPv6(ip) && URL.canParse(`http://[${ip}]`)) {
        const groups = ipv6Groups(ip)
        const [a, b, c, d, e, f, g = 0, h = 0] = groups
        const mapped =
            a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0xffff
        if (mapped) {
            return [g >> 8, g & 0xff, h >> 8, h & 0xff].join(".")
        } else {
            const prefix = groups.slice(0, 4).map((group) => group.toString(16))
            return `${prefix.join(":")}::/64`
        }
    } else {
        // Like a zone (`fe80::1%eth0`), which is only this computer's
        return null
    }
}

// An IPv6 address's eight groups, as numbers. `URL` writes the address in
// its one canonical form first, all in hex, with the longest run of zero
// groups as `::`, which is then filled back in.
function ipv6Groups(ip: string) {
    const canonical = new URL(`http://[${ip}]`).hostname.slice(1, -1)
    const [head = "", tail] = canonical.split("::")
    const left = head === "" ? [] : head.split(":")
    if (tail === undefined) {
        return left.map((group) => Number.parseInt(group, 16))
    } else {
        const right = tail === "" ? [] : tail.split(":")
        const zeros = Array.from(
            { length: 8 - left.length - right.length },
            () => "0"
        )
        return [...left, ...zeros, ...right].map((group) =>
            Number.parseInt(group, 16)
        )
    }
}
