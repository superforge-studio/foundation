import { useMutation, useQuery } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { cn } from "cn"
import { type SubmitEvent, useId, useState } from "react"
import { Button } from "@/frontend/components/primitives/button"
import { Input } from "@/frontend/components/primitives/input"
import { Label } from "@/frontend/components/primitives/label"
import { failureOf } from "@/frontend/queries/failures"
import {
    addUser,
    changeRole,
    type Person,
    removeUser
} from "@/frontend/queries/users"
import { runsQuery } from "@/frontend/queries/workflows"
import {
    EXTERNAL_ROLES,
    type ExternalRole,
    isInternal,
    type Role,
    user_addition
} from "@/utilities/schemas/users"
import { RunStatusMark } from "./marks"
import { BackToList, sectionHeading, textButton } from "./shell"
import { moment, since } from "./words"

// The People screen's two halves: everyone who can log in, and the one
// chosen, or someone being added

/** What a role is called on screen. */
const ROLE_NAMES: Record<Role, string> = {
    internal: "Internal",
    external: "External"
}

/** A person's name, or their address when they haven't given one. */
export function nameOf(person: { name: string | null; email: string }) {
    return person.name ?? person.email
}

/** A role, as a quiet word beside a name. */
function RoleWord({ role }: { role: Role }) {
    return (
        <span
            className={cn(
                "text-xs",
                isInternal(role)
                    ? "font-medium text-foreground"
                    : "text-muted-foreground"
            )}
        >
            {ROLE_NAMES[role]}
        </span>
    )
}

type Filter = "everyone" | "internal" | "external"

/** Everyone, found by name or address, and filtered by who they are. */
export function PeopleList({
    people,
    chosen,
    now
}: {
    people: Person[]
    chosen: string | undefined
    now: Date
}) {
    const [query, setQuery] = useState("")
    const [filter, setFilter] = useState<Filter>("everyone")
    const shown = people.filter(
        (person) =>
            (filter === "everyone" ||
                (filter === "internal") === isInternal(person.role)) &&
            (query === "" ||
                `${person.name ?? ""} ${person.email}`
                    .toLowerCase()
                    .includes(query.trim().toLowerCase()))
    )

    return (
        <>
            <div className="flex shrink-0 flex-col gap-3 border-b px-4 py-3">
                <div className="flex items-center justify-between gap-4">
                    <h1 className={sectionHeading}>People</h1>
                    <Link
                        to="/dashboard/people"
                        search={{ person: "new" }}
                        className={textButton}
                    >
                        Add someone
                    </Link>
                </div>
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
                            ["everyone", "Everyone"],
                            ["internal", "Internal"],
                            ["external", "External"]
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
                        {query === ""
                            ? "No one here yet."
                            : `No one matches “${query}”.`}
                    </li>
                )}
                {shown.map((person) => (
                    <li key={person.id}>
                        <Link
                            to="/dashboard/people"
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
                                    joined {since(person.created_at, now)}
                                </span>
                            </span>
                            <RoleWord role={person.role} />
                        </Link>
                    </li>
                ))}
            </ul>
        </>
    )
}

/**
 * One person: their role, when they joined and last logged in, the runs
 * about them, and removing them. The business's own people are listed in
 * the app's code (backend/auth/access.ts), so they're neither changed nor
 * removed here, and neither are you, who are one of them.
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
            <BackToList to="/dashboard/people">People</BackToList>
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
                    {person.listed || EXTERNAL_ROLES.length === 1 ? (
                        <RoleWord role={person.role} />
                    ) : (
                        <RoleSwitch person={person} />
                    )}
                    <span className="text-muted-foreground text-xs">
                        {person.listed
                            ? "Sees this dashboard. Listed in the app's code, so changed there."
                            : "Sees only their own account."}
                    </span>
                </dd>
                <dt className="text-muted-foreground">Joined</dt>
                <dd className="tabular-nums">{moment(person.created_at)}</dd>
                <dt className="text-muted-foreground">Last logged in</dt>
                <dd className="tabular-nums">
                    {person.logged_in_at === null
                        ? "Never: added by hand"
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

            <section className="flex flex-col gap-3">
                <h3 className={sectionHeading}>Background work about them</h3>
                {about.length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                        No recent runs name them.
                    </p>
                ) : (
                    <ul className="flex flex-col divide-y rounded-lg border">
                        {about.map((run) => (
                            <li key={run.id}>
                                <Link
                                    to="/dashboard/workflows"
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

            {!(you || person.listed) && <RemovePerson person={person} />}
        </article>
    )
}

/**
 * Which role someone external has, as choices side by side, one per
 * external role there is (utilities/schemas/users.ts), for a business with
 * more than one.
 */
function RoleSwitch({ person }: { person: Person }) {
    const change = useMutation(changeRole)
    return (
        <span className="flex flex-col gap-1">
            <fieldset
                disabled={change.isPending}
                className="inline-flex w-fit rounded-lg border bg-muted p-0.5 disabled:opacity-60"
            >
                <legend className="sr-only">Role</legend>
                {EXTERNAL_ROLES.map((role) => (
                    <button
                        key={role}
                        type="button"
                        aria-pressed={person.role === role}
                        onClick={() => {
                            if (person.role !== role) {
                                change.mutate({ id: person.id, role })
                            }
                        }}
                        className="rounded-md px-2.5 py-1 font-medium text-muted-foreground text-xs transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-xs"
                    >
                        {ROLE_NAMES[role]}
                    </button>
                ))}
            </fieldset>
            {change.error !== null && (
                <span role="alert" className="text-destructive text-xs">
                    That didn't change: {failureOf(change.error).message}.
                </span>
            )}
        </span>
    )
}

/**
 * Removing someone, asked once more in place rather than in a dialog: they
 * lose access and every session they have ends.
 */
function RemovePerson({ person }: { person: Person }) {
    const [asking, setAsking] = useState(false)
    const remove = useMutation(removeUser)
    const navigate = useNavigate()

    return (
        <section className="flex flex-col gap-2 border-t pt-6">
            <h3 className="font-medium text-sm">Remove them</h3>
            <p className="max-w-prose text-pretty text-muted-foreground text-sm">
                They lose access and every session they have ends. If they log
                in again, they come back as someone new.
            </p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-1 text-sm">
                {asking ? (
                    <>
                        <span className="text-pretty">
                            Remove {nameOf(person)}?
                        </span>
                        <Button
                            size="sm"
                            variant="destructive"
                            disabled={remove.isPending}
                            onClick={() =>
                                remove.mutate(
                                    { id: person.id },
                                    {
                                        onSuccess: () =>
                                            navigate({
                                                to: "/dashboard/people"
                                            })
                                    }
                                )
                            }
                            className="px-3"
                        >
                            {remove.isPending ? "Removing…" : "Remove"}
                        </Button>
                        <button
                            type="button"
                            className={textButton}
                            onClick={() => setAsking(false)}
                        >
                            Keep them
                        </button>
                    </>
                ) : (
                    <button
                        type="button"
                        className={textButton}
                        onClick={() => setAsking(true)}
                    >
                        Remove…
                    </button>
                )}
            </div>
            {remove.error !== null && (
                <p role="alert" className="text-destructive text-sm">
                    They weren't removed: {failureOf(remove.error).message}.
                </p>
            )}
        </section>
    )
}

/**
 * Adding someone before they log in: their address, a name if it's known,
 * and, for a business with more than one external role, which. They can
 * log in with that address from then on, even when only listed people
 * may. The business's own people aren't added here: they're listed in the
 * app's code (backend/auth/access.ts).
 */
export function AddPersonPane() {
    const ids = useId()
    const add = useMutation(addUser)
    const navigate = useNavigate()
    const [role, setRole] = useState<ExternalRole>(EXTERNAL_ROLES[0])
    const [invalid, setInvalid] = useState<string[]>([])

    function submit(event: SubmitEvent<HTMLFormElement>) {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        const name = String(form.get("name") ?? "").trim()
        // Checked as the API checks it, only to say so at once
        const checked = user_addition.safeParse({
            email: form.get("email"),
            name: name === "" ? undefined : name,
            role
        })
        setInvalid(
            checked.success
                ? []
                : checked.error.issues.map((issue) => String(issue.path[0]))
        )
        if (checked.success) {
            add.mutate(checked.data, {
                onSuccess: (id) =>
                    navigate({
                        to: "/dashboard/people",
                        search: { person: id }
                    })
            })
        }
    }

    const problem = invalid.includes("email")
        ? "Enter their email address, like them@example.com."
        : invalid.includes("name")
          ? "A name is at most 120 characters."
          : add.error === null
            ? null
            : failureOf(add.error).reason === "taken"
              ? "Someone with this address is already here."
              : failureOf(add.error).reason === "listed"
                ? "They're listed as one of the business's own in the app's code, so they can already log in."
                : `They weren't added: ${failureOf(add.error).message}.`

    return (
        <article className="mx-auto flex max-w-xl flex-col gap-6 px-5 py-6 sm:px-10 sm:py-8">
            <BackToList to="/dashboard/people">People</BackToList>
            <header className="flex flex-col gap-1.5">
                <h2 className="font-heading font-semibold text-2xl tracking-tight">
                    Add someone
                </h2>
                <p className="text-pretty text-muted-foreground">
                    They log in with their email, as anyone does, and see only
                    their own account. The business's own people are listed in
                    the app's code instead.
                </p>
            </header>
            <form noValidate onSubmit={submit} className="flex flex-col gap-5">
                <div className="flex flex-col gap-2">
                    <Label htmlFor={`${ids}-email`}>Email</Label>
                    <Input
                        id={`${ids}-email`}
                        name="email"
                        type="email"
                        required
                        autoComplete="off"
                        placeholder="them@example.com"
                        aria-invalid={invalid.includes("email")}
                        className="h-10"
                    />
                </div>
                <div className="flex flex-col gap-2">
                    <Label htmlFor={`${ids}-name`}>
                        Name{" "}
                        <span className="font-normal text-muted-foreground">
                            (if you know it)
                        </span>
                    </Label>
                    <Input
                        id={`${ids}-name`}
                        name="name"
                        autoComplete="off"
                        aria-invalid={invalid.includes("name")}
                        className="h-10"
                    />
                </div>
                {EXTERNAL_ROLES.length > 1 && (
                    <fieldset className="flex flex-col gap-2">
                        <legend className="pb-2 font-medium text-sm">
                            Role
                        </legend>
                        <div className="inline-flex w-fit rounded-lg border bg-muted p-0.5">
                            {EXTERNAL_ROLES.map((each) => (
                                <button
                                    key={each}
                                    type="button"
                                    aria-pressed={role === each}
                                    onClick={() => setRole(each)}
                                    className="rounded-md px-2.5 py-1 font-medium text-muted-foreground text-xs transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-xs"
                                >
                                    {ROLE_NAMES[each]}
                                </button>
                            ))}
                        </div>
                    </fieldset>
                )}
                {problem !== null && (
                    <p role="alert" className="text-destructive text-sm">
                        {problem}
                    </p>
                )}
                <Button
                    type="submit"
                    disabled={add.isPending}
                    className="h-10 w-fit px-4"
                >
                    {add.isPending ? "Adding…" : "Add them"}
                </Button>
            </form>
        </article>
    )
}
