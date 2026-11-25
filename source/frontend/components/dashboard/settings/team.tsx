import { useQuery } from "@tanstack/react-query"
import { cn } from "cn"
import { Plus } from "lucide-react"
import { useId, useState } from "react"
import type { TeamRole } from "@/backend/auth/access"
import { Button } from "@/frontend/components/primitives/button"
import { Input } from "@/frontend/components/primitives/input"
import { Label } from "@/frontend/components/primitives/label"
import { useSession } from "@/frontend/queries/auth"
import { type Person, usersQuery } from "@/frontend/queries/users"
import { allows } from "@/utilities/permissions"
import { RoleMark, useNow } from "../marks"
import { RoleLevels } from "../permissions"
import { CopyPrompt, Step } from "../prompt"
import { CouldNotLoad, initials, sectionHeading, textButton } from "../shell"
import { ROLE_NAMES, since } from "../words"

// Settings' Team: who logs in to the admin, as the app's code lists them
// (backend/auth/app.ts), each with their role and when they last logged
// in, everyone it once listed, taken off, and what each role may do. Nobody
// is added or changed here: Add someone writes the prompt that has Claude
// Code list them, in a pull request, for a role that may change the team.

// Every role there is, in ROLE_NAMES's order, the owner's first.
// Object.keys can only say its keys are strings, but they're ROLE_NAMES's
// own, and ROLE_NAMES has one for every role
const ROLES = Object.keys(ROLE_NAMES) as TeamRole[]

/** The team, owners first, then everyone else on it, then those taken off. */
export function Team() {
    const now = useNow()
    const session = useSession()
    const users = useQuery(usersQuery)
    const [adding, setAdding] = useState(false)
    if (session.status !== "logged-in") {
        return null
    }
    const may_add = allows(session.permissions, "team", "write")
    const people = [...(users.data ?? [])].sort(
        (a, b) =>
            rank(a) - rank(b) ||
            (a.name ?? a.email).localeCompare(b.name ?? b.email)
    )
    // Each role someone on the team has, with what it lets them do
    const roles = ROLES.flatMap((role) => {
        const permissions = people.find(
            (person) => person.role === role
        )?.permissions
        return permissions === undefined || permissions === null
            ? []
            : [{ role, permissions }]
    })

    return (
        <section className="flex flex-col gap-4" aria-labelledby="team-heading">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="flex flex-col gap-1">
                    <h2 id="team-heading" className={sectionHeading}>
                        Team
                    </h2>
                    <p className="max-w-prose text-pretty text-muted-foreground text-sm">
                        Who logs in to the admin. They're listed in the app's
                        code, so adding someone or taking them off is a pull
                        request, which Claude Code opens.
                    </p>
                </div>
                {may_add && !adding && (
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setAdding(true)}
                    >
                        <Plus aria-hidden />
                        Add someone
                    </Button>
                )}
            </div>
            {users.isPending ? (
                <div
                    aria-hidden
                    className="h-40 animate-pulse rounded-xl bg-muted motion-reduce:animate-none"
                />
            ) : users.isError ? (
                <CouldNotLoad what="The team" onRetry={() => users.refetch()} />
            ) : (
                <ul className="flex flex-col divide-y rounded-xl border bg-card">
                    {people.map((person) => (
                        <TeamRow
                            key={person.id}
                            person={person}
                            you={person.id === session.user.id}
                            now={now}
                        />
                    ))}
                </ul>
            )}
            {adding && (
                <AddSomeone
                    taken={people.map((person) => person.slug)}
                    onClose={() => setAdding(false)}
                />
            )}
            {roles.length > 0 && (
                <div className="flex flex-col gap-3 pt-6">
                    <div className="flex flex-col gap-1">
                        <h3 className={sectionHeading}>
                            What each role can do
                        </h3>
                        <p className="max-w-prose text-pretty text-muted-foreground text-sm">
                            As the app's code gives it, in backend/auth/app.ts.
                            The API checks it on every route, for Claude and API
                            tokens too.
                        </p>
                    </div>
                    <RoleLevels roles={roles} />
                </div>
            )}
        </section>
    )
}

// Where someone sorts: owners, then the rest of the team, then those
// taken off it
function rank(person: Person) {
    if (person.role === "owner") {
        return 0
    } else if (person.role !== null) {
        return 1
    } else {
        return 2
    }
}

function TeamRow({
    person,
    you,
    now
}: {
    person: Person
    you: boolean
    now: Date
}) {
    const off = person.role === null
    const browsers =
        person.sessions === 1 ? "1 browser" : `${person.sessions} browsers`
    const when = off
        ? `Taken off ${since(person.deactivated_at ?? person.created_at, now)}. Listing them again with the slug “${person.slug}” brings them back.`
        : person.logged_in_at === null
          ? "Hasn't logged in yet"
          : `Logged in ${since(person.logged_in_at, now)}${person.sessions > 0 ? ` · ${browsers}` : ""}`
    return (
        <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
            <span
                aria-hidden
                className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full font-medium text-xs uppercase",
                    off
                        ? "border border-muted-foreground/50 border-dashed text-muted-foreground"
                        : you
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-foreground"
                )}
            >
                {initials(person)}
            </span>
            <span className="flex min-w-0 flex-1 basis-56 flex-col text-sm leading-snug">
                <span
                    className={cn(
                        "truncate font-medium",
                        off && "text-muted-foreground"
                    )}
                >
                    {person.name ?? person.email}
                    {you && (
                        <span className="font-normal text-muted-foreground">
                            {" "}
                            · you
                        </span>
                    )}
                </span>
                <span className="truncate text-muted-foreground">
                    {person.email}
                </span>
            </span>
            <RoleMark role={person.role} />
            <span className="w-full text-pretty text-muted-foreground text-sm tabular-nums sm:w-56">
                {when}
            </span>
        </li>
    )
}

// A slug from someone's names, as auth/app.ts wants one: lowercase words
// joined by hyphens, their first name, with their last name's first letter
// when the first is taken
function slugFor(first: string, last: string, taken: string[]) {
    const word = (value: string) =>
        value
            .trim()
            .toLowerCase()
            .normalize("NFKD")
            .replaceAll(/[^a-z0-9]+/g, "-")
            .replaceAll(/^-+|-+$/g, "")
    const plain = word(first) || "someone"
    const initial = word(last).slice(0, 1)
    if (!taken.includes(plain)) {
        return plain
    } else if (initial !== "" && !taken.includes(`${plain}-${initial}`)) {
        return `${plain}-${initial}`
    } else {
        return word(`${first} ${last}`) || plain
    }
}

// The roles to choose from, the owner's last, since most people added
// aren't owners
const CHOICES = [
    ...ROLES.filter((role) => role !== "owner"),
    ...ROLES.filter((role) => role === "owner")
]

// Adding someone, which only the code can do: the prompt that has Claude
// Code list them in auth/app.ts, then merging its pull request
function AddSomeone({
    taken,
    onClose
}: {
    taken: string[]
    onClose: () => void
}) {
    const ids = useId()
    const [first, setFirst] = useState("")
    const [last, setLast] = useState("")
    const [email, setEmail] = useState("")
    const [role, setRole] = useState<TeamRole>("member")
    const slug = slugFor(first, last, taken)
    const name =
        `${first.trim() || "[first name]"} ${last.trim() || "[last name]"}`.trim()
    const address = email.trim() || "[their email]"
    const prompt = `Add ${name} (${address}) to the team, in ACCESS.team in source/backend/auth/app.ts, with the slug "${slug}"${role === "member" ? "" : ` and the role "${role}"`}, so they can log in to the admin. Open a pull request.`

    return (
        <section
            aria-labelledby={`${ids}-title`}
            className="flex flex-col gap-5 rounded-xl border bg-card p-5"
        >
            <div className="flex items-center justify-between gap-3">
                <h3 id={`${ids}-title`} className={sectionHeading}>
                    Add someone
                </h3>
                <button type="button" className={textButton} onClick={onClose}>
                    Close
                </button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto] lg:items-end">
                <div className="flex flex-col gap-2">
                    <Label htmlFor={`${ids}-first`}>First name</Label>
                    <Input
                        id={`${ids}-first`}
                        value={first}
                        onChange={(event) => setFirst(event.target.value)}
                        autoComplete="off"
                        className="h-10"
                    />
                </div>
                <div className="flex flex-col gap-2">
                    <Label htmlFor={`${ids}-last`}>Last name</Label>
                    <Input
                        id={`${ids}-last`}
                        value={last}
                        onChange={(event) => setLast(event.target.value)}
                        autoComplete="off"
                        className="h-10"
                    />
                </div>
                <div className="flex flex-col gap-2">
                    <Label htmlFor={`${ids}-email`}>
                        Email they log in with
                    </Label>
                    <Input
                        id={`${ids}-email`}
                        type="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        autoComplete="off"
                        spellCheck={false}
                        className="h-10"
                    />
                </div>
                <fieldset className="flex flex-col gap-2">
                    <legend className="mb-2 font-medium text-sm">Role</legend>
                    <div className="flex gap-1.5">
                        {CHOICES.map((value) => (
                            <label key={value} className="flex-1">
                                <input
                                    type="radio"
                                    name={`${ids}-role`}
                                    value={value}
                                    checked={role === value}
                                    onChange={() => setRole(value)}
                                    className="peer sr-only"
                                />
                                <span className="flex h-10 cursor-pointer items-center justify-center whitespace-nowrap rounded-lg border px-3 text-muted-foreground text-sm transition-colors hover:text-foreground peer-checked:border-foreground peer-checked:font-medium peer-checked:text-foreground peer-focus-visible:outline-2 peer-focus-visible:outline-ring">
                                    {ROLE_NAMES[value]}
                                </span>
                            </label>
                        ))}
                    </div>
                </fieldset>
            </div>
            <ol className="flex flex-col gap-5">
                <Step number={1}>
                    <p className="text-pretty text-sm">
                        Give this to Claude Code. It lists them on the team in
                        the app's code and opens a pull request.
                    </p>
                    <pre className="whitespace-pre-wrap rounded-lg border bg-muted px-3 py-2.5 text-sm">
                        {prompt}
                    </pre>
                    <CopyPrompt prompt={prompt} />
                </Step>
                <Step number={2}>
                    <p className="text-pretty text-sm">
                        Merge the pull request. They can log in once it's
                        deployed, usually within a few minutes, and show up
                        above. Taking someone off is a change in the same place:
                        they're logged out, and what they did stays theirs.
                    </p>
                </Step>
            </ol>
        </section>
    )
}
