import { Link, type LinkProps } from "@tanstack/react-router"
import { cn } from "cn"
import { ArrowLeft, type LucideIcon, Settings } from "lucide-react"
import type { ReactNode } from "react"
import { BusinessMark } from "@/frontend/components/site/business-mark"
import { type Area, allows, type Permissions } from "@/utilities/permissions"

// The dashboard's frame: on a computer, a sidebar down the left with its
// sections and, at its foot, who's logged in, which opens their account,
// with a gear beside them, for a role that may read some part of Settings,
// which opens it; and the screen beside it. On a phone, a bar across the
// top with the same two, and the sections under it. A list screen splits
// its part in two, a list and what's chosen from it, side by side, as a
// mail client lays them out (`Panes`); on a phone the list and the detail
// are a screen each. The admin's sections are in ./navigation.ts, and
// README.md, beside this file, has how a screen is built in it.

/** Classes the dashboard's text buttons and headings share. */
export const textButton =
    "font-medium text-foreground text-sm underline decoration-foreground/40 underline-offset-4 transition-colors hover:decoration-foreground focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
export const sectionHeading =
    "font-heading font-semibold text-base tracking-tight"

/** A dashboard's sections, in groups, which its sidebar moves between. */
export type Navigation = readonly {
    // Its name, over its sections in the sidebar. The first group, the
    // one the dashboard opens on, goes without one
    group?: string
    sections: readonly Section[]
}[]

/** One of a dashboard's sections. */
export type Section = {
    to: NonNullable<LinkProps["to"]>
    name: string
    icon: LucideIcon
    // The area of the app it shows (utilities/permissions/): someone
    // whose role can't read it doesn't see the section, and opening it
    // anyway shows `NotPermitted`. None for one everyone on the team sees,
    // like the Overview
    area?: Area
    // Current only at its own address, not under it too: the one a
    // dashboard opens on, whose address the others start with
    exact?: boolean
}

/**
 * A dashboard's sections that `permissions` may read, in their groups,
 * leaving out a group with none left.
 */
export function shownTo(navigation: Navigation, permissions: Permissions) {
    return navigation
        .map(({ group, sections }) => ({
            group,
            sections: sections.filter(
                (section) =>
                    section.area === undefined ||
                    allows(permissions, section.area, "read")
            )
        }))
        .filter(({ sections }) => sections.length > 0)
}

/**
 * Who's logged in, as the sidebar's foot shows them: their name, or their
 * address when they have none, with a line under it, like their role.
 */
export type FramePerson = {
    name: string | null
    email: string | null
    about: string | null
}

/**
 * The frame every screen of the dashboard sits in: its sections, those
 * whose area someone's role can't read left out (`permissions`), and who's
 * logged in, which opens their account (`account`), with, when
 * `settings`, the gear that opens Settings.
 */
export function DashboardFrame({
    person,
    navigation: every_group,
    permissions,
    account,
    settings,
    children
}: {
    person: FramePerson
    navigation: Navigation
    permissions: Permissions
    account: NonNullable<LinkProps["to"]>
    settings: boolean
    children: ReactNode
}) {
    const navigation = shownTo(every_group, permissions)
    // Every section, in the sidebar's order, for a phone's single row
    const sections = navigation.flatMap((group) => group.sections)
    return (
        <div className="flex h-dvh min-h-[32rem] flex-col md:flex-row">
            {/* A computer's sidebar */}
            <aside className="hidden w-60 shrink-0 flex-col border-r bg-sidebar md:flex">
                <div className="flex h-14 shrink-0 items-center border-b px-4">
                    <BusinessMark />
                </div>
                <nav
                    aria-label="Dashboard"
                    className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-2 pt-4"
                >
                    {navigation.map(({ group, sections: grouped }) => (
                        <div
                            key={group ?? grouped[0]?.to}
                            className="flex flex-col gap-0.5"
                        >
                            {group !== undefined && (
                                <h2 className="px-2.5 pb-1 font-medium text-muted-foreground text-xs">
                                    {group}
                                </h2>
                            )}
                            {grouped.map((section) => (
                                <Link
                                    key={section.to}
                                    to={section.to}
                                    activeOptions={{
                                        exact: section.exact ?? false
                                    }}
                                    className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-muted-foreground text-sm transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring aria-[current=page]:bg-background aria-[current=page]:font-medium aria-[current=page]:text-foreground aria-[current=page]:shadow-xs aria-[current=page]:ring-1 aria-[current=page]:ring-border"
                                >
                                    <section.icon
                                        aria-hidden
                                        className="size-4 shrink-0"
                                    />
                                    {section.name}
                                </Link>
                            ))}
                        </div>
                    ))}
                </nav>
                <div className="mt-auto flex items-center gap-1 border-t p-2">
                    <AccountLink person={person} to={account} />
                    {settings && <SettingsLink />}
                </div>
            </aside>

            {/* A phone's bar, and the sections under it */}
            <header className="shrink-0 border-b bg-sidebar md:hidden">
                <div className="flex h-14 items-center gap-4 px-4">
                    <BusinessMark className="shrink-0" />
                    <div className="ml-auto flex items-center gap-1">
                        {settings && <SettingsLink />}
                        <AccountLink person={person} to={account} compact />
                    </div>
                </div>
                <nav
                    aria-label="Dashboard"
                    className="flex gap-1 overflow-x-auto px-3 pb-2"
                >
                    {sections.map((section) => (
                        <Link
                            key={section.to}
                            to={section.to}
                            activeOptions={{ exact: section.exact ?? false }}
                            className="shrink-0 rounded-md px-3 py-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring aria-[current=page]:bg-primary aria-[current=page]:font-medium aria-[current=page]:text-primary-foreground"
                        >
                            {section.name}
                        </Link>
                    ))}
                </nav>
            </header>

            <main className="flex min-h-0 min-w-0 flex-1 flex-col">
                {children}
            </main>
        </div>
    )
}

// Who's logged in, which opens their account: their initials, their name
// and the line under it, like their role, or only the initials on a phone.
// Its current look is a section's in the sidebar.
function AccountLink({
    person,
    to,
    compact = false
}: {
    person: FramePerson
    to: NonNullable<LinkProps["to"]>
    compact?: boolean
}) {
    const name = person.name ?? person.email ?? "Your account"
    return (
        <Link
            to={to}
            activeOptions={{ exact: true }}
            aria-label={compact ? "Your account" : undefined}
            className={cn(
                "flex min-w-0 items-center gap-2.5 rounded-md text-sm transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring aria-[current=page]:bg-background aria-[current=page]:shadow-xs aria-[current=page]:ring-1 aria-[current=page]:ring-border",
                compact ? "p-1" : "flex-1 p-1.5"
            )}
        >
            <span
                aria-hidden
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary font-medium text-primary-foreground text-xs uppercase"
            >
                {initials(person)}
            </span>
            {!compact && (
                <span className="flex min-w-0 flex-col leading-tight">
                    <span className="truncate font-medium">{name}</span>
                    {person.about !== null && (
                        <span className="truncate text-muted-foreground text-xs">
                            {person.about}
                        </span>
                    )}
                </span>
            )}
        </Link>
    )
}

// The gear beside who's logged in, which opens Settings, drawn as a
// section of the sidebar is while it's open
function SettingsLink() {
    return (
        <Link
            to="/admin/settings"
            aria-label="Settings"
            title="Settings"
            className="flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring aria-[current=page]:bg-background aria-[current=page]:text-foreground aria-[current=page]:shadow-xs aria-[current=page]:ring-1 aria-[current=page]:ring-border"
        >
            <Settings aria-hidden className="size-4" />
        </Link>
    )
}

/** One or two letters for someone: their name's, or their address's. */
export function initials(person: {
    name: string | null
    email: string | null
}) {
    const words = (person.name ?? "").split(/\s+/).filter((word) => word !== "")
    const first = words[0]
    const last = words.length > 1 ? words[words.length - 1] : undefined
    if (first === undefined) {
        return (person.email ?? "?").slice(0, 1)
    } else {
        return `${first.slice(0, 1)}${last?.slice(0, 1) ?? ""}`
    }
}

/**
 * The two panes of a list screen: the list, and the detail of what's
 * chosen. On a phone, only one shows: the list until something is chosen,
 * then its detail, with the way back (`BackToList`).
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
    to: NonNullable<LinkProps["to"]>
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

/**
 * What a section shows someone whose role can't read its area: why, and
 * who can change that. The API refuses them whatever this shows.
 */
export function NotPermitted({ name }: { name: string }) {
    return (
        <SinglePane>
            <div className="flex flex-col gap-3">
                <h1 className="text-balance font-heading font-semibold text-2xl tracking-tight">
                    Your role can't see {name}
                </h1>
                <p className="max-w-prose text-pretty text-muted-foreground">
                    Each role on the team sees what the app's code gives it, in
                    backend/auth/app.ts. Ask the owner if you need this.
                </p>
                <Link
                    to="/admin/account"
                    className="w-fit text-sm underline underline-offset-4"
                >
                    See what your role can do
                </Link>
            </div>
        </SinglePane>
    )
}

/**
 * A page of the admin that isn't there, in the admin's own frame, with the
 * way back: what routes/admin/route.tsx answers for an address under it
 * that's no page. Anywhere else, the site's own not-found page answers
 * (components/states/not-found.tsx).
 */
export function AdminNotFound() {
    return (
        <SinglePane>
            <div className="flex flex-col gap-3">
                <p className="text-muted-foreground text-sm">404</p>
                <h1 className="text-balance font-heading font-semibold text-2xl tracking-tight">
                    There's nothing here.
                </h1>
                <Link
                    to="/admin"
                    className="w-fit text-sm underline underline-offset-4"
                >
                    Back to the Overview
                </Link>
            </div>
        </SinglePane>
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
