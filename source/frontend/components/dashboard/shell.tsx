import { Link } from "@tanstack/react-router"
import { cn } from "cn"
import { ArrowLeft } from "lucide-react"
import type { ReactNode } from "react"
import { BusinessMark } from "@/frontend/components/site/business-mark"
import type { SessionUser } from "@/frontend/queries/auth"

// The dashboard's frame: a bar across the top, and under it a list and
// what's chosen from it, side by side, as a mail client lays them out. On a
// phone the list and the detail are a screen each.

/** Classes the dashboard's text buttons and headings share. */
export const textButton =
    "font-medium text-foreground text-sm underline decoration-foreground/40 underline-offset-4 transition-colors hover:decoration-foreground focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
export const sectionHeading =
    "font-heading font-semibold text-base tracking-tight"

// The business's side of the dashboard, which the switch in the bar moves
// between
const SECTIONS = [
    { to: "/dashboard/workflows", name: "Workflows" },
    { to: "/dashboard/people", name: "People" }
] as const

/**
 * The bar: the business's mark, the switch between its sections for its
 * own people, and who's logged in, which opens their account.
 */
export function DashboardBar({
    user,
    internal
}: {
    user: SessionUser
    internal: boolean
}) {
    return (
        <header className="flex h-14 shrink-0 items-center gap-4 border-b bg-sidebar px-4 sm:px-5">
            <BusinessMark className="shrink-0" />
            {internal && (
                <nav
                    aria-label="Dashboard"
                    className="flex rounded-lg border bg-background p-0.5"
                >
                    {SECTIONS.map((section) => (
                        <Link
                            key={section.to}
                            to={section.to}
                            className="rounded-md px-3 py-1 text-muted-foreground text-sm transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring aria-[current=page]:bg-primary aria-[current=page]:font-medium aria-[current=page]:text-primary-foreground"
                        >
                            {section.name}
                        </Link>
                    ))}
                </nav>
            )}
            <Link
                to="/dashboard/account"
                aria-label="Your account"
                className="ml-auto flex min-w-0 items-center gap-2 rounded-md px-1 py-1 text-sm transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring aria-[current=page]:bg-muted sm:px-2"
            >
                <span
                    aria-hidden
                    className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary font-medium text-[0.65rem] text-primary-foreground uppercase"
                >
                    {initials(user)}
                </span>
                <span className="hidden truncate text-muted-foreground sm:inline">
                    {user.email}
                </span>
            </Link>
        </header>
    )
}

// One or two letters for someone: their name's, or their address's
function initials(user: { name: string | null; email: string }) {
    const words = (user.name ?? "").split(/\s+/).filter((word) => word !== "")
    const first = words[0]
    const last = words[words.length - 1]
    if (first === undefined || last === undefined) {
        return user.email.slice(0, 1)
    } else if (words.length === 1) {
        return first.slice(0, 1)
    } else {
        return `${first.slice(0, 1)}${last.slice(0, 1)}`
    }
}

/**
 * The two panes: the list, and the detail of what's chosen. On a phone,
 * only one shows: the list until something is chosen, then its detail,
 * with the way back.
 */
export function Panes({
    list,
    detail,
    chosen
}: {
    list: ReactNode
    detail: ReactNode
    chosen: boolean
}) {
    return (
        <div className="flex min-h-0 flex-1">
            <div
                className={cn(
                    "min-h-0 w-full flex-col border-r bg-sidebar md:flex md:w-[22rem] md:shrink-0",
                    chosen ? "hidden" : "flex"
                )}
            >
                {list}
            </div>
            <div
                className={cn(
                    "min-h-0 flex-1 overflow-y-auto md:block",
                    chosen ? "block" : "hidden"
                )}
            >
                {detail}
            </div>
        </div>
    )
}

/** The way back to the list from a detail, on a phone. */
export function BackToList({
    to,
    children
}: {
    to: "/dashboard/workflows" | "/dashboard/people"
    children: string
}) {
    return (
        <Link
            to={to}
            className="flex w-fit items-center gap-1.5 text-muted-foreground text-sm hover:text-foreground md:hidden"
        >
            <ArrowLeft aria-hidden className="size-4" />
            {children}
        </Link>
    )
}

/** A screen that isn't a list: the account, alone in the frame. */
export function SinglePane({ children }: { children: ReactNode }) {
    return (
        <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto flex max-w-2xl flex-col gap-8 px-5 py-8 sm:px-8 sm:py-10">
                {children}
            </div>
        </div>
    )
}

/** What a list says while it loads: rows to come, not a spinner. */
export function ListLoading() {
    return (
        <div aria-hidden className="flex flex-col gap-2 p-4">
            {[0, 1, 2, 3].map((row) => (
                <div
                    key={row}
                    className="h-11 animate-pulse rounded-md bg-muted motion-reduce:animate-none"
                />
            ))}
        </div>
    )
}

/** What a screen says when the API couldn't answer it. */
export function CouldNotLoad({
    what,
    onRetry
}: {
    what: string
    onRetry: () => void
}) {
    return (
        <div role="alert" className="flex flex-col gap-2 p-4 text-sm">
            <p className="text-pretty text-destructive">
                {what} didn't load. The server may be restarting.
            </p>
            <button
                type="button"
                className={cn(textButton, "w-fit")}
                onClick={onRetry}
            >
                Try again
            </button>
        </div>
    )
}
