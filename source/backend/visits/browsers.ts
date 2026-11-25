import Bowser from "bowser"
import { isbot } from "isbot"
import type { Device } from "@/utilities/visitors"

// What a visitor's browser says of itself in its User-Agent, which the
// server reads and doesn't keep: whether it's a bot (`isbot`, Umami's
// choice), and what kind of device, which browser and which OS (`bowser`)

/** What's kept of a visitor's User-Agent. */
export type BrowserFacts = {
    device: Device | null
    browser: string | null
    os: string | null
}

/**
 * Whether `user_agent` is a bot's, or none at all, which no real browser
 * sends: a batch of events from either is answered and dropped.
 */
export function isBot(user_agent: string) {
    return user_agent.trim() === "" || isbot(user_agent)
}

/**
 * What `user_agent` says, or null for a bot's, or for none at all, which
 * no real browser sends.
 */
export function describeBrowser(user_agent: string): BrowserFacts | null {
    if (isBot(user_agent)) {
        return null
    }
    const parsed = Bowser.parse(user_agent)
    const type = parsed.platform.type
    return {
        device:
            type === "mobile" || type === "tablet" || type === "desktop"
                ? type
                : null,
        browser: parsed.browser.name ?? null,
        os: parsed.os.name ?? null
    }
}
