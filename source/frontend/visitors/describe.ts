import type { EventProperties } from "@/utilities/schemas/events"

// What an event says about the page, from what the browser tells the
// script: the path and the title, where a visitor came from, what they
// clicked and what went wrong. Nothing here touches the page itself (browser.ts does), so
// the tests run it in Node. A query string or a fragment can hold a token
// or an address, so none is ever kept, and neither is anything shaped like
// an email address.

/** The longest a click's text is kept. */
const LONGEST_TEXT = 80

/** The longest an error's message is kept. */
const LONGEST_MESSAGE = 500

/** The longest a campaign's parameter, from the address, is kept. */
const LONGEST_CAMPAIGN = 200

/** The longest an ad's click ID, from the address, is kept: all of it. */
const LONGEST_CLICK_ID = 1000

/** The longest a page's title is kept. */
const LONGEST_TITLE = 200

/** The longest a click's name, its `data-track`, is kept. */
const LONGEST_NAME = 64

/** The longest a browser's language, like `en-US`, is kept. */
const LONGEST_LANGUAGE = 35

/**
 * A campaign's parameter in a landing's address: `utm_`, then its name,
 * which as a property is at most 64 characters.
 */
const CAMPAIGN_PARAMETER = /^utm_[\w-]{1,60}$/

/** The most campaign parameters a landing keeps, the first in its address. */
const CAMPAIGN_PARAMETERS = 10

/**
 * The ad networks' click IDs a landing's address can carry, which tie a
 * visit to the ad it came from: Google's (`gclid`, and `gbraid` and
 * `wbraid` from iPhones), Meta's, Microsoft's, TikTok's and LinkedIn's.
 */
const CLICK_IDS = [
    "gclid",
    "gbraid",
    "wbraid",
    "fbclid",
    "msclkid",
    "ttclid",
    "li_fat_id"
] as const

/**
 * A page's path as the server takes it: from `/`, at most 2,048
 * characters, with no query or fragment.
 */
export function pagePath(pathname: string) {
    const [path = ""] = pathname.split(/[?#]/)
    if (path.startsWith("/")) {
        return path.slice(0, 2048)
    } else {
        return `/${path}`.slice(0, 2048)
    }
}

/**
 * Free text as an event keeps it: on one line, every email address left
 * out, every web address without its query or fragment, no U+0000, and at
 * most `longest` characters, as the server counts them (UTF-16 units),
 * never cutting an emoji in two, which the database can't keep.
 */
export function scrub(text: string, longest: number) {
    const cut = text
        .replace(/\S+@\S+\.\S+/g, "[email]")
        .replace(/(https?:\/\/[^\s?#]+)[?#]\S*/g, "$1")
        .replaceAll("\u0000", "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, longest)
    // The first half of a pair the cut left without its second
    return cut.replace(/[\uD800-\uDBFF]$/, "").trimEnd()
}

// A hostname without a leading `www.`, so a site's two names are one
function siteOf(hostname: string) {
    return hostname.replace(/^www\./, "")
}

// An address, read against `base` when it's relative, or null when it
// isn't one. Not `URL.canParse`, which older browsers lack.
function parsedUrl(text: string, base?: string) {
    try {
        return new URL(text, base)
    } catch (error) {
        console.debug("Visitors: not an address", { text, error })
        return null
    }
}

/** What every view says about its page: its `title`, scrubbed. */
export function viewProperties(title: string): EventProperties {
    const scrubbed = scrub(title, LONGEST_TITLE)
    if (scrubbed === "") {
        return {}
    } else {
        return { title: scrubbed }
    }
}

/** What the script reads off the page a visitor landed on (browser.ts). */
export type Landing = {
    // The address the page landed on
    url: string
    // `document.referrer`: the page before, or empty
    referrer: string
    // `document.title`
    title: string
    // The screen's size in CSS pixels, or null where it can't be read
    screen: { width: number; height: number } | null
    // `navigator.language`, like `en-US`
    language: string
}

/**
 * What the first view of a visit to the site says, beside its `title`:
 * where the visitor came from (`referrer`, the other site's hostname,
 * never one of this site's own pages; every `utm_` parameter in the
 * address it landed on, the first ten; and an ad's click ID, like
 * `gclid`), and what they came on (`screen`, like `1920x1080`, and
 * `language`).
 */
export function landingProperties(landing: Landing): EventProperties {
    const properties: EventProperties = viewProperties(landing.title)
    const landed = parsedUrl(landing.url)
    const from = landing.referrer === "" ? null : parsedUrl(landing.referrer)
    if (
        from !== null &&
        (from.protocol === "http:" || from.protocol === "https:") &&
        (landed === null || siteOf(from.hostname) !== siteOf(landed.hostname))
    ) {
        properties.referrer = from.hostname
    }
    if (landed !== null) {
        Object.assign(properties, addressProperties(landed.searchParams))
    }
    if (landing.screen !== null) {
        const { width, height } = landing.screen
        properties.screen = `${Math.round(width)}x${Math.round(height)}`
    }
    const language = scrub(landing.language, LONGEST_LANGUAGE)
    if (language !== "") {
        properties.language = language
    }
    return properties
}

// What a landing's address says of the campaign and the ad it came from:
// each `utm_` parameter, the first ten, and each click ID, the first of
// each name, scrubbed, and none that's empty
function addressProperties(parameters: URLSearchParams) {
    const properties: EventProperties = {}
    let campaign = 0
    for (const [name, value] of parameters) {
        const scrubbed = scrub(value, LONGEST_CAMPAIGN)
        if (
            CAMPAIGN_PARAMETER.test(name) &&
            campaign < CAMPAIGN_PARAMETERS &&
            !Object.hasOwn(properties, name) &&
            scrubbed !== ""
        ) {
            properties[name] = scrubbed
            campaign += 1
        }
    }
    for (const name of CLICK_IDS) {
        const scrubbed = scrub(parameters.get(name) ?? "", LONGEST_CLICK_ID)
        if (scrubbed !== "") {
            properties[name] = scrubbed
        }
    }
    return properties
}

/** What the script reads off an element a visitor clicked (browser.ts). */
export type ClickedElement = {
    // Its tag, lowercase: `a`, `button`, or whatever has `role="button"`
    tag: string
    // Its `data-track`, the name the app gave the click, or null
    name: string | null
    // Its `aria-label`, its name when it shows no text, like an icon's
    label: string | null
    // The text it shows
    text: string
    // A link's `href`, as written, or null for anything else
    href: string | null
    // Whether it may show something private, so its text isn't kept: it's
    // a form's field, or inside `data-private`, as the dashboard is
    private: boolean
}

/**
 * A click's properties: `target`, the element's `data-track` or else its
 * tag; `text`, its label or what it shows, scrubbed, unless it's private;
 * and for a link, `href`: the path on this site, the address without its
 * query on another, or only the scheme of anything else, like `mailto:`.
 */
export function clickProperties(
    element: ClickedElement,
    page_url: string
): EventProperties {
    const name = scrub(element.name ?? "", LONGEST_NAME)
    const properties: EventProperties = {
        target: name === "" ? element.tag : name
    }
    const text = scrub(element.label ?? element.text, LONGEST_TEXT)
    if (!element.private && text !== "") {
        properties.text = text
    }
    const to = element.href === null ? null : parsedUrl(element.href, page_url)
    if (to === null) {
        return properties
    } else if (to.protocol !== "http:" && to.protocol !== "https:") {
        properties.href = to.protocol
    } else if (to.origin === parsedUrl(page_url)?.origin) {
        properties.href = to.pathname
    } else {
        properties.href = `${to.origin}${to.pathname}`
    }
    return properties
}

/** What the script reads off an error (browser.ts). */
export type PageError = {
    message: string
    // The script's address, and where in it
    source: string | null
    line: number | null
    column: number | null
}

/**
 * An error's properties: `message`, scrubbed, and where it happened:
 * `source`, the script's address without its query, `line` and `column`.
 */
export function errorProperties(error: PageError): EventProperties {
    const message = scrub(error.message, LONGEST_MESSAGE)
    const properties: EventProperties = {
        message: message === "" ? "(no message)" : message
    }
    if (error.source !== null && error.source !== "") {
        properties.source = scrub(error.source, LONGEST_MESSAGE)
    }
    if (error.line !== null && Number.isFinite(error.line)) {
        properties.line = error.line
    }
    if (error.column !== null && Number.isFinite(error.column)) {
        properties.column = error.column
    }
    return properties
}

/**
 * A promise's rejection as an error: its message, and where it was thrown,
 * from the first line of its stack that names a script.
 */
export function rejectionError(reason: unknown): PageError {
    const message =
        reason instanceof Error
            ? `${reason.name}: ${reason.message}`
            : typeof reason === "string"
              ? reason
              : "A promise was rejected"
    const stack = reason instanceof Error ? (reason.stack ?? "") : ""
    const place = /(https?:\/\/[^\s)]+?):(\d+):(\d+)/.exec(stack)
    return {
        message,
        source: place?.[1] ?? null,
        line: place?.[2] === undefined ? null : Number(place[2]),
        column: place?.[3] === undefined ? null : Number(place[3])
    }
}
