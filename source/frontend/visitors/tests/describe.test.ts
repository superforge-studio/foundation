import { expect, test, vi } from "vitest"
import { event_properties } from "@/utilities/schemas/events"
import {
    type ClickedElement,
    clickProperties,
    errorProperties,
    type Landing,
    landingProperties,
    pagePath,
    rejectionError,
    scrub,
    viewProperties
} from "../describe"

// What an event says about the page: never a query, a fragment or an
// email address, and only so much of anything

const PAGE = "https://example.com/pricing?coupon=SECRET#plans"

// A landing with nothing to say but what a test gives it
function landing(overrides: Partial<Landing>): Landing {
    return {
        url: "https://example.com/",
        referrer: "",
        title: "",
        screen: null,
        language: "",
        ...overrides
    }
}

function link(overrides: Partial<ClickedElement>): ClickedElement {
    return {
        tag: "a",
        name: null,
        label: null,
        text: "",
        href: null,
        private: false,
        ...overrides
    }
}

test("a path is the page's path alone", () => {
    expect(pagePath("/pricing")).toBe("/pricing")
    expect(pagePath("/reset?token=abc#top")).toBe("/reset")
    expect(pagePath("pricing")).toBe("/pricing")
    expect(pagePath(`/${"a".repeat(3000)}`)).toHaveLength(2048)
})

test("free text loses email addresses, queries and extra space", () => {
    expect(scrub("  Logged in as\n ada@example.com  ", 80)).toBe(
        "Logged in as [email]"
    )
    expect(
        scrub("Failed to load https://api.example.com/reset?token=abc", 80)
    ).toBe("Failed to load https://api.example.com/reset")
    expect(scrub("x".repeat(100), 80)).toHaveLength(80)
})

test("a landing names the site it came from, never this one", () => {
    expect(
        landingProperties(
            landing({ referrer: "https://news.ycombinator.com/item?id=1" })
        )
    ).toEqual({ referrer: "news.ycombinator.com" })
    expect(
        landingProperties(
            landing({
                url: "https://example.com/pricing",
                referrer: "https://www.example.com/"
            })
        )
    ).toEqual({})
    expect(landingProperties(landing({}))).toEqual({})
})

test("a landing keeps every utm_ parameter in its address, and nothing else of it", () => {
    expect(
        landingProperties(
            landing({
                url: "https://example.com/?utm_source=newsletter&utm_medium=email&utm_campaign=%20launch%20&utm_term=crm&utm_content=hero&utm_id=42&utm_source_platform=meta&utm_source=again&utm_empty=&utm_=x&email=ada@example.com&utm_contact=ada@example.com"
            })
        )
    ).toEqual({
        utm_source: "newsletter",
        utm_medium: "email",
        utm_campaign: "launch",
        utm_term: "crm",
        utm_content: "hero",
        utm_id: "42",
        utm_source_platform: "meta",
        utm_contact: "[email]"
    })
})

test("a landing keeps the first ten utm_ parameters", () => {
    const parameters = Array.from(
        { length: 14 },
        (_, index) => `utm_custom_${index}=${index}`
    ).join("&")
    const properties = landingProperties(
        landing({ url: `https://example.com/?${parameters}` })
    )
    expect(Object.keys(properties)).toEqual(
        Array.from({ length: 10 }, (_, index) => `utm_custom_${index}`)
    )
})

test("a landing keeps an ad's click ID, whole", () => {
    const gclid = `Cj0KCQiA${"x".repeat(200)}`
    expect(
        landingProperties(
            landing({
                url: `https://example.com/?gclid=${gclid}&gbraid=0AAAAA&wbraid=CkAB&fbclid=IwAR1&msclkid=abc123&ttclid=E.C.P&li_fat_id=7f3c&dclid=nope`
            })
        )
    ).toEqual({
        gclid,
        gbraid: "0AAAAA",
        wbraid: "CkAB",
        fbclid: "IwAR1",
        msclkid: "abc123",
        ttclid: "E.C.P",
        li_fat_id: "7f3c"
    })
})

test("a landing says what it came on: the screen's size and the browser's language", () => {
    expect(
        landingProperties(
            landing({
                screen: { width: 390, height: 844.5 },
                language: "en-GB"
            })
        )
    ).toEqual({ screen: "390x845", language: "en-GB" })
})

test("every view keeps its page's title, scrubbed", () => {
    expect(viewProperties("Pricing · Acme")).toEqual({
        title: "Pricing · Acme"
    })
    expect(viewProperties("  Welcome back,\n ada@example.com ")).toEqual({
        title: "Welcome back, [email]"
    })
    expect(viewProperties("x".repeat(300)).title).toHaveLength(200)
    expect(viewProperties("   ")).toEqual({})
    expect(landingProperties(landing({ title: "Home" }))).toEqual({
        title: "Home"
    })
})

test("everything a landing can say stays within what Infra takes", () => {
    const campaign = Array.from(
        { length: 20 },
        (_, index) => `utm_${"c".repeat(55)}${index}=${"v".repeat(400)}`
    ).join("&")
    const ads = [
        "gclid",
        "gbraid",
        "wbraid",
        "fbclid",
        "msclkid",
        "ttclid",
        "li_fat_id"
    ]
        .map((name) => `${name}=${"a".repeat(2000)}`)
        .join("&")
    const properties = landingProperties({
        url: `https://example.com/?${campaign}&${ads}`,
        referrer: "https://news.ycombinator.com/",
        title: "t".repeat(2000),
        screen: { width: 1920, height: 1080 },
        language: "en-US"
    })
    expect(Object.keys(properties)).toHaveLength(21)
    expect(event_properties.safeParse(properties).success).toBe(true)
})

test("a click is named by data-track, or by its tag", () => {
    expect(clickProperties(link({ name: "book-a-call" }), PAGE)).toEqual({
        target: "book-a-call"
    })
    expect(
        clickProperties(link({ tag: "button", text: " Book a call " }), PAGE)
    ).toEqual({ target: "button", text: "Book a call" })
})

test("a click's text is its label, short, and never private", () => {
    expect(
        clickProperties(
            link({ tag: "a", label: "Your account", text: "AL ada@x.com" }),
            PAGE
        ).text
    ).toBe("Your account")
    expect(clickProperties(link({ text: "word ".repeat(40) }), PAGE).text).toBe(
        "word ".repeat(16).trimEnd()
    )
    expect(
        clickProperties(link({ text: "Grace Hopper", private: true }), PAGE)
    ).toEqual({ target: "a" })
})

test("a link's href is a path here, an address elsewhere, and never a query", () => {
    expect(
        clickProperties(link({ href: "/login?next=/admin#x" }), PAGE).href
    ).toBe("/login")
    expect(
        clickProperties(link({ href: "https://example.com/about" }), PAGE).href
    ).toBe("/about")
    expect(
        clickProperties(
            link({ href: "https://cal.com/acme/intro?email=ada@x.com" }),
            PAGE
        ).href
    ).toBe("https://cal.com/acme/intro")
    expect(
        clickProperties(link({ href: "mailto:hello@example.com" }), PAGE).href
    ).toBe("mailto:")
    expect(clickProperties(link({ href: "tel:+15550100" }), PAGE).href).toBe(
        "tel:"
    )
})

test("an address that isn't one is left out", () => {
    vi.spyOn(console, "debug").mockImplementation(() => {})
    expect(clickProperties(link({ href: "http://[" }), PAGE)).toEqual({
        target: "a"
    })
})

test("an error keeps its message, short, and where it happened", () => {
    expect(
        errorProperties({
            message: `TypeError: ${"x".repeat(600)}`,
            source: "https://example.com/assets/index-abc.js?v=2",
            line: 12,
            column: 34
        })
    ).toEqual({
        message: `TypeError: ${"x".repeat(489)}`,
        source: "https://example.com/assets/index-abc.js",
        line: 12,
        column: 34
    })
    expect(
        errorProperties({ message: "", source: null, line: null, column: null })
    ).toEqual({ message: "(no message)" })
})

test("a rejection says what it was, and where its stack starts", () => {
    const error = new TypeError("Failed to fetch")
    error.stack =
        "TypeError: Failed to fetch\n    at load (https://example.com/assets/index-abc.js?v=2:10:20)"
    expect(rejectionError(error)).toEqual({
        message: "TypeError: Failed to fetch",
        source: "https://example.com/assets/index-abc.js?v=2",
        line: 10,
        column: 20
    })
    expect(rejectionError("nope")).toMatchObject({
        message: "nope",
        source: null
    })
    expect(rejectionError({ code: 1 }).message).toBe("A promise was rejected")
})
