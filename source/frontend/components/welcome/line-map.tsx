import { Link } from "@tanstack/react-router"
import { cn } from "cn"
import { RotateCw } from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"
import { Button } from "@/frontend/components/primitives/button"
import { useAddress } from "./environment"
import { type Finding, useFinding } from "./finding"
import { type Recovery, RecoveryNote, recoveryFor } from "./recovery"
import {
    adminStatus,
    apiStatus,
    databaseStatus,
    loginStatus,
    type Status,
    StatusLine,
    storageStatus,
    type Tone,
    websiteStatus,
    workflowsStatus
} from "./status"

// The app as a transit line, a stop for each part, drawn in the theme's main
// color: you, the website, the API with login, the admin, Storage and
// the workflows on branches, and the database. The health check runs down it as a pulse each
// time it's asked; a stop it passes through fills in, and where it can't
// get through, the line turns red and the stop says what to do. The parts
// still to come are stops on a dashed line.

type Station = {
    name: string
    kind?: string
    what: string
    path?: string
    status?: Status
    // A page of the app's that shows this part working
    page?: { to: "/login" | "/admin"; label: string }
    shape: "origin" | "stop" | "branch" | "planned"
    // Which part this is, when a failed check can be about it
    checks?: Recovery["part"]
}

// The parts coming to Foundation, in the order they're expected to ship, as
// dashed stops at the end of the line. None, for now: each part on the line
// is built.
const PLANNED: Station[] = []

// Where the API's stop and the database's are on the line: the first the
// check can find broken, and the last it runs to
const API_POSITION = 2
const DATABASE_POSITION = 7

// How long the pulse takes over each stretch of line it runs. The check
// itself often answers in a few milliseconds; the stops wait for the pulse
// to arrive before they show what it found, so it can be seen.
const STRETCH_MS = 180

const TRAVEL = `
@keyframes travel {
    0% { top: 0; opacity: 1; }
    99% { top: 100%; opacity: 1; }
    100% { top: 100%; opacity: 0; }
}
`

/** The line, with the check it runs and a button to run it again. */
export function LineMap({ className }: { className?: string }) {
    const { found, checking, checkAgain } = useFinding()
    const { run, arrived } = usePulse(checking)
    const address = useAddress()

    // Until the pulse reaches the database, the stops it checks are still
    // being checked
    const seen: Finding = arrived ? found : { state: "checking" }
    const recovery = recoveryFor(seen)

    const stations: Station[] = [
        {
            name: "You",
            what:
                address === null
                    ? "Your browser"
                    : `Your browser, at ${address}`,
            shape: "origin"
        },
        {
            name: "Website",
            kind: "TanStack Start",
            what: "The pages, each one built ahead of time. This one is routes/index.tsx.",
            path: "source/frontend/",
            status: websiteStatus(),
            shape: "stop"
        },
        {
            name: "API",
            kind: "Hono, under /api",
            what: "Everything the site reads and writes goes through it.",
            path: "source/backend/",
            status: apiStatus(seen),
            shape: "stop",
            checks: "api"
        },
        {
            name: "Login",
            kind: "Superforge Infra",
            what: "Your team logs in with a code or a link by email. No passwords.",
            path: "source/backend/auth/",
            page: { to: "/login", label: "Try logging in" },
            status: loginStatus(),
            shape: "branch"
        },
        {
            name: "Admin",
            kind: "/admin",
            what: "Your team sees the workflows as they run and who's on the team, each as their role allows.",
            path: "source/frontend/routes/admin/",
            page: { to: "/admin", label: "Open the admin" },
            status: adminStatus(),
            shape: "branch"
        },
        {
            name: "Storage",
            kind: "a bucket",
            what: "Files: uploads, images, exports.",
            path: "source/database/storage/",
            status: storageStatus(),
            shape: "branch"
        },
        {
            name: "Workflows",
            kind: "DBOS",
            what: "Background work that picks up where it stopped.",
            path: "source/backend/workflows/",
            status: workflowsStatus(),
            shape: "branch"
        },
        {
            name: "Database",
            kind: "Postgres",
            what: "What the business keeps: customers, orders, bookings.",
            path: "source/database/schema/app.ts",
            status: databaseStatus(seen),
            shape: "stop",
            checks: "database"
        }
    ]

    return (
        <section
            aria-labelledby="line"
            className={cn("@container flex flex-col gap-6", className)}
        >
            <style href="welcome-line-map" precedence="default">
                {TRAVEL}
            </style>
            <div className="flex items-center justify-between gap-4">
                <h2
                    id="line"
                    className="font-heading font-semibold text-lg tracking-tight"
                >
                    The line
                </h2>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={checkAgain}
                    disabled={checking || !arrived}
                    className="-mr-2 text-muted-foreground"
                >
                    <RotateCw aria-hidden />
                    Run it again
                </Button>
            </div>

            <ol>
                {stations.map((station, index) => (
                    <StationRow
                        key={station.name}
                        station={station}
                        recovery={
                            recovery !== null &&
                            recovery.part === station.checks
                                ? recovery
                                : null
                        }
                        stretch={
                            // The line ends at the database, unless there
                            // are parts still to come after it
                            index < DATABASE_POSITION || PLANNED.length > 0 ? (
                                <Stretch
                                    index={index}
                                    run={run}
                                    live={index < DATABASE_POSITION}
                                    planned={index >= DATABASE_POSITION}
                                    broken={index >= brokenFrom(seen)}
                                />
                            ) : null
                        }
                    />
                ))}
                {PLANNED.length > 0 && (
                    <li className="relative grid grid-cols-[2rem_minmax(0,1fr)] gap-x-4 pb-6">
                        <Stretch index={-1} run={run} planned />
                        <p className="col-start-2 font-medium text-muted-foreground text-xs">
                            Coming to Foundation
                        </p>
                    </li>
                )}
                {PLANNED.map((station, index) => (
                    <StationRow
                        key={station.name}
                        station={station}
                        stretch={
                            index < PLANNED.length - 1 ? (
                                <Stretch index={-1} run={run} planned />
                            ) : null
                        }
                    />
                ))}
            </ol>
        </section>
    )
}

// The pulse runs each time a check starts, and has arrived once it's had
// time to reach the database. Nothing runs for anyone who asks for less
// motion: what the check found shows as soon as it answers.
function usePulse(checking: boolean) {
    const [run, setRun] = useState(0)
    const [arrived, setArrived] = useState(false)

    useEffect(() => {
        if (checking) {
            setRun((previous) => previous + 1)
        }
    }, [checking])

    useEffect(() => {
        if (run === 0) {
            return
        }
        const still = window.matchMedia(
            "(prefers-reduced-motion: reduce)"
        ).matches
        setArrived(false)
        const timer = setTimeout(
            () => setArrived(true),
            still ? 0 : STRETCH_MS * DATABASE_POSITION
        )
        return () => clearTimeout(timer)
    }, [run])

    return { run, arrived }
}

// Where the check stopped, as the first stretch of line it couldn't run:
// the whole run from the API to the database when the API couldn't reach
// it (the branches stay as they are), everything past the website when the
// API didn't answer, and none when it all answered
function brokenFrom(found: Finding): number {
    switch (found.state) {
        case "database-down":
            return API_POSITION
        case "api-down":
            return API_POSITION - 1
        case "checking":
        case "up":
            return Number.POSITIVE_INFINITY
    }
}

// The line from this stop's dot to the next one's, solid where it's built,
// dashed where it isn't and red where the check couldn't get through, with
// the pulse running down it when a check starts. A branch's row carries the
// main line straight past it.
function Stretch({
    index,
    run,
    live = false,
    planned = false,
    broken = false
}: {
    index: number
    run: number
    live?: boolean
    planned?: boolean
    broken?: boolean
}) {
    let track: string
    if (planned) {
        track = "border-muted-foreground/40 border-l-4 border-dashed"
    } else if (broken) {
        track = "bg-destructive"
    } else {
        track = "bg-primary"
    }
    return (
        <span
            aria-hidden
            className={cn(
                "absolute top-3 -bottom-3 left-[calc(1rem-2px)] w-1 transition-colors duration-200",
                track
            )}
        >
            {live && run > 0 && (
                <span
                    key={run}
                    className="absolute inset-x-0 h-6 -translate-y-1/2 rounded-full bg-background/85 opacity-0 motion-reduce:hidden"
                    style={{
                        animation: `travel ${STRETCH_MS}ms linear ${index * STRETCH_MS}ms forwards`
                    }}
                />
            )}
        </span>
    )
}

// One stop: its dot on the line, its name and what it's made with, what the
// check found, and what it's for. Its status sits beside its name when
// there's room for both, and under it when there isn't. The stop a failed
// check was about says how to fix it, right under it.
function StationRow({
    station,
    stretch,
    recovery = null
}: {
    station: Station
    stretch: ReactNode
    recovery?: Recovery | null
}) {
    const branch = station.shape === "branch"
    return (
        <li
            className={cn(
                "relative grid gap-x-4",
                branch
                    ? "grid-cols-[2rem_1rem_minmax(0,1fr)] pb-7"
                    : "grid-cols-[2rem_minmax(0,1fr)] pb-8"
            )}
        >
            {stretch}
            <StationDot shape={station.shape} tone={station.status?.tone} />
            {branch && (
                <span
                    aria-hidden
                    className="absolute top-[calc(0.75rem-2px)] left-4 h-1 w-[2.25rem] bg-primary/45"
                />
            )}
            <div
                className={cn(
                    "flex min-w-0 flex-col gap-1",
                    branch ? "col-start-3" : "col-start-2"
                )}
            >
                <div className="flex flex-col gap-1 @lg:flex-row @lg:flex-wrap @lg:items-baseline @lg:justify-between @lg:gap-x-6">
                    <h3
                        className={cn(
                            "font-heading font-semibold tracking-tight",
                            branch ? "text-sm leading-6" : "text-base",
                            station.shape === "planned" &&
                                "text-muted-foreground"
                        )}
                    >
                        {station.name}
                        {station.kind !== undefined && (
                            <span className="ml-2 font-normal font-sans text-muted-foreground text-sm tracking-normal">
                                {station.kind}
                            </span>
                        )}
                    </h3>
                    {station.status !== undefined && (
                        <StatusLine status={station.status} />
                    )}
                </div>
                <p className="text-pretty text-muted-foreground text-sm">
                    {station.what}
                </p>
                {station.page !== undefined && (
                    <Link
                        to={station.page.to}
                        className="w-fit text-sm underline decoration-foreground/40 underline-offset-4 hover:decoration-foreground"
                    >
                        {station.page.label}
                    </Link>
                )}
                {station.path !== undefined && (
                    <code className="font-mono text-foreground/70 text-xs">
                        {station.path}
                    </code>
                )}
                {recovery !== null && (
                    <RecoveryNote recovery={recovery} className="mt-3" />
                )}
            </div>
        </li>
    )
}

// A stop is a ring on the line, filled once the check has passed through it
// and red where it couldn't; the origin is a filled dot, a branch a smaller
// ring off the line, and a stop still to come a dashed ring
function StationDot({
    shape,
    tone
}: {
    shape: Station["shape"]
    tone: Tone | undefined
}) {
    let stop: string
    if (tone === "ok") {
        stop = "border-primary bg-primary"
    } else if (tone === "problem") {
        stop = "border-destructive bg-background"
    } else {
        stop = "border-primary bg-background"
    }
    return (
        <span
            aria-hidden
            className={cn(
                "relative z-10 row-start-1 justify-self-center rounded-full transition-colors duration-200",
                shape === "origin" && "col-start-1 mt-1 size-4 bg-primary",
                shape === "stop" &&
                    cn("col-start-1 mt-1 size-4 border-[3px]", stop),
                shape === "branch" &&
                    "col-start-2 mt-1.5 size-3 border-[2.5px] border-primary/60 bg-background",
                shape === "planned" &&
                    "col-start-1 mt-1 size-4 border-[3px] border-muted-foreground/45 border-dashed bg-background"
            )}
        />
    )
}
