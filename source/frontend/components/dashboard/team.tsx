import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useState } from "react"
import { Input } from "@/frontend/components/primitives/input"
import type { Person } from "@/frontend/queries/users"
import { runsQuery } from "@/frontend/queries/workflows"
import { RunStatusMark } from "./marks"
import { AreaLevels, ROLE_NAMES } from "./permissions"
import { BackToList, sectionHeading } from "./shell"
import { moment, since } from "./words"

// The Team screen's two halves: the team, as the app's code lists it, and
// the one chosen. Nothing here changes anyone: the team is listed in
// backend/auth/access.ts, and changes there.

/** A person's name, or their address when they haven't one. */
export function nameOf(person: { name: string | null; email: string }) {
    return person.name ?? person.email
}

/** A role, or that they've been taken off the team, as a quiet word. */
function RoleWord({ person }: { person: Person }) {
    return person.role === null ? (
        <span className="text-muted-foreground text-xs">Taken off</span>
    ) : (
        <span
            className={
                person.role === "owner"
                    ? "font-medium text-foreground text-xs"
                    : "text-muted-foreground text-xs"
            }
        >
            {ROLE_NAMES[person.role]}
        </span>
    )
}

type Filter = "team" | "taken-off"

/** The team, found by name or address, or those taken off it. */
export function TeamList({
    people,
    chosen,
    now
}: {
    people: Person[]
    chosen: string | undefined
    now: Date
}) {
    const [query, setQuery] = useState("")
    const [filter, setFilter] = useState<Filter>("team")
    const shown = people.filter(
        (person) =>
            (filter === "team") === person.listed &&
            (query === "" ||
                `${person.name ?? ""} ${person.email}`
                    .toLowerCase()
                    .includes(query.trim().toLowerCase()))
    )

    return (
        <>
            <div className="flex shrink-0 flex-col gap-3 border-b px-4 py-3">
                <h1 className={sectionHeading}>Team</h1>
                <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Find by name or email"
                    aria-label="Find someone"
                    className="h-9 bg-background"
                />
                <div role="tablist" className="flex gap-1">
                    {(
                        [
                            ["team", "On the team"],
                            ["taken-off", "Taken off"]
                        ] as const
                    ).map(([value, label]) => (
                        <button
                            key={value}
                            type="button"
                            role="tab"
                            aria-selected={filter === value}
                            onClick={() => setFilter(value)}
                            className="rounded-md px-2 py-1 text-muted-foreground text-xs transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring aria-selected:bg-background aria-selected:font-medium aria-selected:text-foreground aria-selected:ring-1 aria-selected:ring-border"
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>
            <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2 pb-4">
                {shown.length === 0 && (
                    <li className="px-2 py-2 text-pretty text-muted-foreground text-sm">
                        {query !== ""
                            ? `No one matches “${query}”.`
                            : filter === "team"
                              ? "No one is on the team yet."
                              : "No one has been taken off the team."}
                    </li>
                )}
                {shown.map((person) => (
                    <li key={person.id}>
                        <Link
                            to="/admin/team"
                            search={{ person: person.id }}
                            aria-current={
                                chosen === person.id ? "true" : undefined
                            }
                            className="flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-background focus-visible:outline-2 focus-visible:outline-ring aria-[current=true]:bg-background aria-[current=true]:shadow-xs aria-[current=true]:ring-1 aria-[current=true]:ring-border"
                        >
                            <span className="flex min-w-0 flex-1 flex-col">
                                <span className="truncate text-sm">
                                    {nameOf(person)}
                                </span>
                                <span className="truncate text-muted-foreground text-xs tabular-nums">
                                    {person.logged_in_at === null
                                        ? "never logged in"
                                        : `logged in ${since(person.logged_in_at, now)}`}
                                </span>
                            </span>
                            <RoleWord person={person} />
                        </Link>
                    </li>
                ))}
            </ul>
            <p className="shrink-0 border-t px-4 py-3 text-pretty text-muted-foreground text-xs">
                The team is listed in the app's code, in backend/auth/access.ts.
                Adding someone there lets them log in from the next deploy.
            </p>
        </>
    )
}

/**
 * One person: their role and what it lets them do, when they joined and
 * last logged in, the browsers they're on, and the runs about them. Each
 * is as the app's code lists them (backend/auth/access.ts), so they change
 * there, not here.
 */
export function PersonDetailPane({
    person,
    you
}: {
    person: Person
    you: boolean
}) {
    const runs = useQuery(runsQuery)
    const about = (runs.data ?? []).filter((run) =>
        run.input.includes(person.id)
    )

    return (
        <article className="mx-auto flex max-w-3xl flex-col gap-8 px-5 py-6 sm:px-10 sm:py-8">
            <BackToList to="/admin/team">Team</BackToList>
            <header className="flex flex-col gap-1">
                <h2 className="text-balance break-words font-heading font-semibold text-2xl tracking-tight">
                    {nameOf(person)}
                    {you && (
                        <span className="ml-3 font-normal font-sans text-base text-muted-foreground tracking-normal">
                            You
                        </span>
                    )}
                </h2>
                {person.name !== null && (
                    <p className="text-muted-foreground">{person.email}</p>
                )}
            </header>

            <dl className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm sm:grid-cols-[9rem_minmax(0,1fr)]">
                <dt className="self-center text-muted-foreground">Role</dt>
                <dd className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <RoleWord person={person} />
                    <span className="text-muted-foreground text-xs">
                        {person.deactivated_at === null
                            ? "Listed in the app's code, so changed there."
                            : `Taken off the team ${since(person.deactivated_at)}. Listing them again with the slug “${person.slug}” brings them back.`}
                    </span>
                </dd>
                <dt className="text-muted-foreground">Joined</dt>
                <dd className="tabular-nums">{moment(person.created_at)}</dd>
                <dt className="text-muted-foreground">Last logged in</dt>
                <dd className="tabular-nums">
                    {person.logged_in_at === null
                        ? "Never"
                        : moment(person.logged_in_at)}
                </dd>
                <dt className="text-muted-foreground">Logged in on</dt>
                <dd className="tabular-nums">
                    {person.sessions === 0
                        ? "No browsers right now"
                        : person.sessions === 1
                          ? "1 browser"
                          : `${person.sessions} browsers`}
                </dd>
            </dl>

            {person.permissions !== null && (
                <section className="flex flex-col gap-3">
                    <h3 className={sectionHeading}>What they can do</h3>
                    <AreaLevels permissions={person.permissions} />
                </section>
            )}

            <section className="flex flex-col gap-3">
                <h3 className={sectionHeading}>Background work about them</h3>
                {runs.isPending ? null : about.length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                        No recent runs name them.
                    </p>
                ) : (
                    <ul className="flex flex-col divide-y rounded-lg border">
                        {about.map((run) => (
                            <li key={run.id}>
                                <Link
                                    to="/admin/workflows"
                                    search={{ run: run.id }}
                                    className="flex items-center gap-4 px-4 py-3 text-sm transition-colors hover:bg-muted/50"
                                >
                                    <RunStatusMark status={run.status} />
                                    <span className="min-w-0 flex-1 truncate">
                                        {run.title}
                                    </span>
                                    <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
                                        {since(run.created_at)}
                                    </span>
                                </Link>
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </article>
    )
}
