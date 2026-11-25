// How the dashboard says times, browsers and roles, in words a person
// reads at a glance, with the exact moment for a title or a detail

import type { TeamRole } from "@/backend/auth/access"
import { DAY, HOUR, MINUTE } from "@/utilities/primitives/durations"

/**
 * How long ago, for a list: "just now", "4 min ago", "2 h ago",
 * "yesterday", "3 days ago", then the date.
 */
export function since(when: Date | string, now: Date = new Date()) {
    const at = new Date(when)
    const elapsed = now.getTime() - at.getTime()
    if (elapsed < MINUTE) {
        return "just now"
    } else if (elapsed < HOUR) {
        return `${Math.floor(elapsed / MINUTE)} min ago`
    } else if (elapsed < DAY) {
        return `${Math.floor(elapsed / HOUR)} h ago`
    } else if (elapsed < 2 * DAY) {
        return "yesterday"
    } else if (elapsed < 7 * DAY) {
        return `${Math.floor(elapsed / DAY)} days ago`
    } else {
        return at.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: at.getFullYear() === now.getFullYear() ? undefined : "numeric"
        })
    }
}

/**
 * A day, past or to come, for when the time of day doesn't matter: "Feb 14",
 * with the year when it isn't this one, "Feb 14, 2027".
 */
export function day(when: Date | string, now: Date = new Date()) {
    const at = new Date(when)
    return at.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: at.getFullYear() === now.getFullYear() ? undefined : "numeric"
    })
}

/** The moment in full: "Nov 15, 11:28 AM". */
export function moment(when: Date | string) {
    return new Date(when).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
    })
}

// The browsers and systems a browser's description names, in the order
// they're checked: Edge and Opera say "Chrome" too, and Chrome "Safari"
const BROWSERS = [
    ["Edg/", "Edge"],
    ["OPR/", "Opera"],
    ["Firefox/", "Firefox"],
    ["Chrome/", "Chrome"],
    ["Safari/", "Safari"]
] as const
const SYSTEMS = [
    ["iPhone", "an iPhone"],
    ["iPad", "an iPad"],
    ["Android", "Android"],
    ["Mac OS X", "a Mac"],
    ["Windows", "Windows"],
    ["CrOS", "a Chromebook"],
    ["Linux", "Linux"]
] as const

/**
 * A browser, from what it said of itself (its User-Agent): "Safari on an
 * iPhone", or "A browser" when it said nothing anyone knows.
 */
export function describeBrowser(user_agent: string | null) {
    if (user_agent === null) {
        return "A browser"
    }
    const browser = BROWSERS.find(([mark]) => user_agent.includes(mark))?.[1]
    const system = SYSTEMS.find(([mark]) => user_agent.includes(mark))?.[1]
    if (browser !== undefined && system !== undefined) {
        return `${browser} on ${system}`
    } else if (browser !== undefined) {
        return browser
    } else if (system !== undefined) {
        return `A browser on ${system}`
    } else {
        return "A browser"
    }
}

/** Whether a browser's description is a phone's or a tablet's. */
export function isHandheld(user_agent: string | null) {
    return user_agent !== null && /iPhone|iPad|Android|Mobile/.test(user_agent)
}

/**
 * What each role is called on screen, the one list of them: a role a
 * business adds (`TEAM_ROLES`, backend/auth/access.ts) goes here, and the
 * typecheck fails until it does.
 */
export const ROLE_NAMES: Record<TeamRole, string> = {
    owner: "Owner",
    member: "Member"
}

/** A team member's role, as the dashboard names it. */
export function roleName(role: TeamRole) {
    return ROLE_NAMES[role]
}
