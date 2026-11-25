import { useMutation, useQuery } from "@tanstack/react-query"
import { Lock, LogOut, Monitor, Smartphone } from "lucide-react"
import type { ReactNode } from "react"
import { Button } from "@/frontend/components/primitives/button"
import {
    accountSessionsQuery,
    endAccountSession,
    logOutOthers
} from "@/frontend/queries/account"
import { logOut, type SessionUser } from "@/frontend/queries/auth"
import { failureOf } from "@/frontend/queries/failures"
import type { Permissions } from "@/utilities/permissions"
import { ApiTokens } from "./api-tokens"
import { Connections } from "./connections"
import { RoleMark, useNow } from "./marks"
import { AreaLevels } from "./permissions"
import { CopyPrompt } from "./prompt"
import { sectionHeading, textButton } from "./shell"
import { describeBrowser, isHandheld, moment, ROLE_NAMES, since } from "./words"

// Someone's own account, whatever their role, which their name at the
// sidebar's foot opens: who they're listed as, with nothing to change
// here, what their role lets them do, the browsers they're logged in on,
// with logging out of the others, where they've let Claude in
// (connections.tsx), and their API tokens (api-tokens.tsx).

export function AccountPanel({
    user,
    permissions
}: {
    user: SessionUser
    permissions: Permissions
}) {
    return (
        <div className="flex flex-col gap-10">
            <ListedDetails user={user} />
            <WhatYouCanDo user={user} permissions={permissions} />
            <Sessions />
            <Connections />
            <ApiTokens />
        </div>
    )
}

/**
 * Who they are, as the app's code lists them (backend/auth/access.ts), so
 * nothing here changes: their names, their slug, the address they log in
 * with, and their role. An owner gets a prompt that has Claude Code change
 * them; anyone else asks an owner.
 */
function ListedDetails({ user }: { user: SessionUser }) {
    const rows: { term: string; value: ReactNode; note?: string }[] = [
        { term: "First name", value: user.first_name },
        { term: "Last name", value: user.last_name },
        {
            term: "Handle",
            value: <span className="font-mono">{user.slug}</span>,
            note: "What the app's code calls you. It never changes, so what you've done stays yours."
        },
        {
            term: "Login email",
            value: user.email,
            note: "Your login codes and links go here."
        },
        {
            term: "Role",
            value: <RoleMark role={user.role} />,
            note:
                user.role === "owner"
                    ? "You may do everything there is, in every area of the app."
                    : "What it lets you do is below, as the app's code gives it."
        }
    ]
    return (
        <section
            aria-labelledby="details-heading"
            className="flex flex-col gap-4"
        >
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="details-heading" className={sectionHeading}>
                    Your details
                </h2>
                <span className="inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-muted-foreground text-xs">
                    <Lock aria-hidden className="size-3" />
                    Set in the app's code
                </span>
            </div>
            <dl className="flex flex-col divide-y rounded-xl border bg-card">
                {rows.map(({ term, value, note }) => (
                    <div
                        key={term}
                        className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4"
                    >
                        <dt className="text-muted-foreground">{term}</dt>
                        <dd className="flex min-w-0 flex-col gap-1">
                            <span className="break-words font-medium">
                                {value}
                            </span>
                            {note !== undefined && (
                                <span className="text-pretty text-muted-foreground">
                                    {note}
                                </span>
                            )}
                        </dd>
                    </div>
                ))}
            </dl>
            {user.role === "owner" ? (
                <div className="flex flex-col gap-2">
                    <p className="max-w-prose text-pretty text-muted-foreground text-sm">
                        You're listed in{" "}
                        <span className="font-mono text-foreground">
                            backend/auth/access.ts
                        </span>
                        , so these change there, with a pull request.
                    </p>
                    <CopyPrompt
                        look="text"
                        label="Copy a change for Claude Code"
                        prompt={`I'm ${user.name ?? user.email}, listed on the team in ACCESS.internal_users in source/backend/auth/access.ts with the slug "${user.slug}". Ask me what to change about my first name, last name or login email, change it there, keeping my slug as it is, and open a pull request.`}
                    />
                </div>
            ) : (
                <p className="max-w-prose text-pretty text-muted-foreground text-sm">
                    You're listed in the app's code, so these change there: ask
                    the owner.
                </p>
            )}
        </section>
    )
}

/**
 * What their role lets them do in each area of the app, as the code gives
 * it (backend/auth/access.ts): what the admin shows them, and what Claude
 * and their API tokens may do as them, at most.
 */
function WhatYouCanDo({
    user,
    permissions
}: {
    user: SessionUser
    permissions: Permissions
}) {
    return (
        <section className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
                <h2 className={sectionHeading}>What you can do</h2>
                <p className="max-w-prose text-pretty text-muted-foreground text-sm">
                    You're {user.role === "owner" ? "an" : "a"}{" "}
                    {ROLE_NAMES[user.role].toLowerCase()}. Claude and your API
                    tokens can do no more than this, and only as much as you let
                    them.
                </p>
            </div>
            <AreaLevels permissions={permissions} />
        </section>
    )
}

function Sessions() {
    const now = useNow()
    const sessions = useQuery(accountSessionsQuery)
    const end = useMutation(endAccountSession)
    const others = useMutation(logOutOthers)
    const leave = useMutation(logOut)
    const list = sessions.data ?? []
    const has_others = list.some((session) => !session.current)
    const failed = end.error ?? others.error ?? leave.error

    return (
        <section className="flex flex-col gap-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
                <h2 className={sectionHeading}>Where you're logged in</h2>
                {has_others && (
                    <button
                        type="button"
                        className={textButton}
                        disabled={others.isPending}
                        onClick={() => others.mutate()}
                    >
                        {others.isPending
                            ? "Logging out…"
                            : "Log out everywhere else"}
                    </button>
                )}
            </div>
            {sessions.isPending ? (
                <div
                    aria-hidden
                    className="h-32 animate-pulse rounded-lg bg-muted motion-reduce:animate-none"
                />
            ) : sessions.isError ? (
                <p role="alert" className="text-destructive text-sm">
                    Your sessions didn't load. Try again in a moment.
                </p>
            ) : (
                <ul className="flex flex-col divide-y rounded-lg border">
                    {list.map((session) => {
                        const Icon = isHandheld(session.user_agent)
                            ? Smartphone
                            : Monitor
                        return (
                            <li
                                key={session.id}
                                className="flex items-center gap-3 px-4 py-3"
                            >
                                <Icon
                                    aria-hidden
                                    className="size-4 shrink-0 text-muted-foreground"
                                />
                                <div className="flex min-w-0 flex-1 flex-col">
                                    <span className="text-sm">
                                        {describeBrowser(session.user_agent)}
                                    </span>
                                    <span
                                        className="text-muted-foreground text-xs tabular-nums"
                                        title={`Logged in ${moment(session.created_at)}`}
                                    >
                                        {session.current
                                            ? "This browser"
                                            : `Last used ${since(session.renewed_at, now)}`}
                                        {" · "}
                                        logged in{" "}
                                        {since(session.created_at, now)}
                                    </span>
                                </div>
                                {!session.current && (
                                    <button
                                        type="button"
                                        className={textButton}
                                        disabled={end.isPending}
                                        onClick={() =>
                                            end.mutate({ id: session.id })
                                        }
                                    >
                                        Log out
                                    </button>
                                )}
                            </li>
                        )
                    })}
                </ul>
            )}
            {failed !== null && (
                <p role="alert" className="text-destructive text-sm">
                    That didn't log out: {failureOf(failed).message}. Try again
                    in a moment.
                </p>
            )}
            <Button
                variant="outline"
                disabled={leave.isPending}
                onClick={() => leave.mutate()}
                className="h-10 w-fit px-4"
            >
                <LogOut aria-hidden />
                {leave.isPending ? "Logging out…" : "Log out of this browser"}
            </Button>
        </section>
    )
}
