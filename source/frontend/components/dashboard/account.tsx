import { useMutation, useQuery } from "@tanstack/react-query"
import { LogOut, Monitor, Smartphone } from "lucide-react"
import { type SubmitEvent, useId, useState } from "react"
import { Button } from "@/frontend/components/primitives/button"
import { Input } from "@/frontend/components/primitives/input"
import { Label } from "@/frontend/components/primitives/label"
import {
    accountSessionsQuery,
    endAccountSession,
    logOutOthers,
    renameAccount
} from "@/frontend/queries/account"
import { logOut, type SessionUser } from "@/frontend/queries/auth"
import { failureOf } from "@/frontend/queries/failures"
import { isInternal, person_name } from "@/utilities/schemas/users"
import { ApiTokens } from "./api-tokens"
import { Connections } from "./connections"
import { useNow } from "./marks"
import { sectionHeading, textButton } from "./shell"
import { describeBrowser, isHandheld, moment, since } from "./words"

// Someone's own account, whatever their role: a customer's whole dashboard,
// and one screen of an internal person's. What they're called, the address
// they log in with, and the browsers they're logged in on, with logging
// out of the others, and for the business's own, where they've let Claude
// in (connections.tsx) and their API tokens (api-tokens.tsx).

export function AccountPanel({ user }: { user: SessionUser }) {
    return (
        <div className="flex flex-col gap-10">
            <DetailsForm user={user} />
            <Sessions />
            {isInternal(user.role) && <Connections />}
            {isInternal(user.role) && <ApiTokens />}
        </div>
    )
}

function DetailsForm({ user }: { user: SessionUser }) {
    if (isInternal(user.role)) {
        return <ListedDetails user={user} />
    } else {
        return <NameForm user={user} />
    }
}

/**
 * One of the business's own: their name and address are the ones they're
 * listed with in the app's code (backend/auth/access.ts), so they change
 * there, not here.
 */
function ListedDetails({ user }: { user: SessionUser }) {
    return (
        <div className="flex flex-col gap-5">
            <h2 className={sectionHeading}>Your details</h2>
            <div className="flex flex-col gap-1">
                <span className="font-medium text-sm">Name</span>
                <span className="text-sm">{user.name ?? "No name yet"}</span>
            </div>
            <LoginEmail email={user.email} />
            <p className="max-w-prose text-pretty text-muted-foreground text-sm">
                You're listed as one of the business's own in the app's code,
                with this name and address, so they change there.
            </p>
        </div>
    )
}

/** The address someone logs in with, which never changes here. */
function LoginEmail({ email }: { email: string }) {
    return (
        <div className="flex flex-col gap-1">
            <span className="font-medium text-sm">Login email</span>
            <span className="text-sm">{email}</span>
            <span className="text-muted-foreground text-sm">
                Your login codes and links go here.
            </span>
        </div>
    )
}

function NameForm({ user }: { user: SessionUser }) {
    const ids = useId()
    const rename = useMutation(renameAccount)
    const [name, setName] = useState(user.name ?? "")
    const [invalid, setInvalid] = useState(false)
    const unchanged = name.trim() === (user.name ?? "")

    function save(event: SubmitEvent<HTMLFormElement>) {
        event.preventDefault()
        if (name.trim() === "") {
            setInvalid(false)
            rename.mutate({ name: null })
        } else {
            // Checked as the API checks it, only to say so at once
            const checked = person_name.safeParse(name)
            setInvalid(!checked.success)
            if (checked.success) {
                rename.mutate({ name: checked.data })
            }
        }
    }

    const problem = invalid
        ? "A name is at most 120 characters."
        : rename.error !== null
          ? `That didn't save: ${failureOf(rename.error).message}.`
          : null

    return (
        <form noValidate onSubmit={save} className="flex flex-col gap-5">
            <h2 className={sectionHeading}>Your details</h2>
            <div className="flex flex-col gap-2">
                <Label htmlFor={`${ids}-name`}>Name</Label>
                <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                        id={`${ids}-name`}
                        value={name}
                        autoComplete="name"
                        placeholder="What should we call you?"
                        aria-invalid={problem !== null}
                        aria-describedby={`${ids}-problem`}
                        onChange={(event) => {
                            setName(event.target.value)
                            rename.reset()
                        }}
                        className="h-10 sm:max-w-sm"
                    />
                    <Button
                        type="submit"
                        variant="outline"
                        disabled={rename.isPending || unchanged}
                        className="h-10 px-4"
                    >
                        {rename.isPending
                            ? "Saving…"
                            : rename.isSuccess && unchanged
                              ? "Saved"
                              : "Save name"}
                    </Button>
                </div>
                <p
                    id={`${ids}-problem`}
                    role={problem === null ? undefined : "alert"}
                    className="text-destructive text-sm empty:hidden"
                >
                    {problem}
                </p>
            </div>
            <LoginEmail email={user.email} />
        </form>
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
