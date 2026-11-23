import { useMutation, useQuery } from "@tanstack/react-query"
import { LogOut, Monitor, Smartphone } from "lucide-react"
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
import { useNow } from "./marks"
import { AreaLevels, ROLE_NAMES } from "./permissions"
import { sectionHeading, textButton } from "./shell"
import { describeBrowser, isHandheld, moment, since } from "./words"

// Someone's own account, whatever their role: who they're listed as, what
// their role lets them do, the browsers they're logged in on, with logging
// out of the others, where they've let Claude in (connections.tsx), and
// their API tokens (api-tokens.tsx).

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
 * Their name and address are the ones they're listed with in the app's
 * code (backend/auth/access.ts), so they change there, not here.
 */
function ListedDetails({ user }: { user: SessionUser }) {
    return (
        <div className="flex flex-col gap-5">
            <h2 className={sectionHeading}>Your details</h2>
            <div className="flex flex-col gap-1">
                <span className="font-medium text-sm">Name</span>
                <span className="text-sm">{user.name ?? "No name yet"}</span>
            </div>
            <div className="flex flex-col gap-1">
                <span className="font-medium text-sm">Login email</span>
                <span className="text-sm">{user.email}</span>
                <span className="text-muted-foreground text-sm">
                    Your login codes and links go here.
                </span>
            </div>
            <p className="max-w-prose text-pretty text-muted-foreground text-sm">
                You're on the team in the app's code, with this name and
                address, so they change there.
            </p>
        </div>
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
