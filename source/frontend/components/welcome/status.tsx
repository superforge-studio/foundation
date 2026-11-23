import { cn } from "cn"
import {
    Circle,
    CircleAlert,
    CircleCheck,
    CircleHelp,
    LoaderCircle
} from "lucide-react"
import { IN_DEVELOPMENT } from "./environment"
import type { Finding } from "./finding"

/**
 * How sure the page is about a part: seen working, being checked, broken,
 * unknown because something before it broke, or a fact it didn't check.
 */
export type Tone = "ok" | "checking" | "problem" | "unknown" | "fact"

/** What the page says about a part: a tone, a line, and a quieter second one. */
export type Status = {
    tone: Tone
    label: string
    detail?: string
}

const ICONS = {
    ok: CircleCheck,
    checking: LoaderCircle,
    problem: CircleAlert,
    unknown: CircleHelp,
    fact: Circle
} as const

const ICON_COLORS = {
    ok: "text-success",
    checking: "animate-spin text-muted-foreground motion-reduce:animate-none",
    problem: "text-destructive",
    unknown: "text-muted-foreground",
    fact: "text-muted-foreground/60"
} as const

/** A status as an icon and a line, with its quieter line under it. */
export function StatusLine({
    status,
    className
}: {
    status: Status
    className?: string
}) {
    const Icon = ICONS[status.tone]
    return (
        <span className={cn("flex items-start gap-2 text-sm", className)}>
            <Icon
                aria-hidden
                className={cn(
                    "mt-0.5 size-4 shrink-0",
                    ICON_COLORS[status.tone]
                )}
            />
            <span className="flex min-w-0 flex-col">
                <span
                    className={cn(
                        "tabular-nums",
                        status.tone === "fact"
                            ? "text-muted-foreground"
                            : "text-foreground"
                    )}
                >
                    {status.label}
                </span>
                {status.detail !== undefined && (
                    <span className="text-muted-foreground text-xs">
                        {status.detail}
                    </span>
                )}
            </span>
        </span>
    )
}

// What each part's status is, from the one health check. The website is up
// if this page is showing; the API is up if it answered at all, even to say
// the database is down; the database is up only if the API reached it.

export function websiteStatus(): Status {
    return { tone: "ok", label: "Serving this page" }
}

export function apiStatus(found: Finding): Status {
    switch (found.state) {
        case "checking":
            return { tone: "checking", label: "Checking…" }
        case "up":
        case "database-down":
            return {
                tone: "ok",
                label: `Answered in ${found.milliseconds} ms`
            }
        case "api-down":
            return { tone: "problem", label: "Not answering" }
    }
}

export function databaseStatus(found: Finding): Status {
    switch (found.state) {
        case "checking":
            return { tone: "checking", label: "Checking…" }
        case "up":
            return { tone: "ok", label: "Connected" }
        case "database-down":
            return { tone: "problem", label: "The API can't reach it" }
        case "api-down":
            return {
                tone: "unknown",
                label: "Unknown",
                detail: "The API didn't answer"
            }
    }
}

// Login, the dashboard, Storage and workflows aren't checked live: the page says where
// they are instead, which differs between the dev server and a build

export function loginStatus(): Status {
    if (IN_DEVELOPMENT) {
        return {
            tone: "fact",
            label: "Codes shown on the page",
            detail: "A dev server emails nothing"
        }
    } else {
        return {
            tone: "fact",
            label: "Emailed by Superforge Infra",
            detail: "With INFRA_SECRET_KEY, not checked live"
        }
    }
}

export function storageStatus(): Status {
    if (IN_DEVELOPMENT) {
        return {
            tone: "fact",
            label: "A folder on this computer",
            detail: ".storage/, not checked live"
        }
    } else {
        return {
            tone: "fact",
            label: "Railway's bucket",
            detail: "Not checked live"
        }
    }
}

export function dashboardStatus(): Status {
    return {
        tone: "fact",
        label: "Behind login",
        detail: "Drawn in the browser, for whoever's logged in"
    }
}

export function workflowsStatus(): Status {
    return {
        tone: "fact",
        label: "Run in this server",
        detail: "Kept in Postgres, not checked live"
    }
}
