import { useMutation, useQuery } from "@tanstack/react-query"
import { Check, Copy, KeyRound } from "lucide-react"
import { type SubmitEvent, useId, useState } from "react"
import { Button } from "@/frontend/components/primitives/button"
import { Input } from "@/frontend/components/primitives/input"
import { Label } from "@/frontend/components/primitives/label"
import {
    type AccountApiToken,
    accountTokensQuery,
    makeApiToken,
    revokeApiToken
} from "@/frontend/queries/account"
import { failureOf } from "@/frontend/queries/failures"
import type { AgentScope } from "@/utilities/schemas/agents"
import {
    API_TOKEN_LIFETIMES,
    type ApiTokenLifetime,
    api_token_name
} from "@/utilities/schemas/api-tokens"
import { useNow } from "./marks"
import { sectionHeading, textButton } from "./shell"
import { day, moment, since } from "./words"

// One of the business's own's API tokens, on their account page: for a
// script, a scheduled job or another platform's agent, which can't log in
// through a browser as Claude does (connections.tsx), to call the app's API
// as them (backend/auth/api-tokens.ts). Making one shows it once; the list
// after shows each by its name and its last characters, when it was last
// used, and Revoke, which ends it at once.

// What a token may do, as the choices name it
const ACCESS = {
    read: { scopes: ["read"], name: "Read only" },
    act: { scopes: ["read", "act"], name: "Read and act" }
} as const satisfies Record<string, { scopes: AgentScope[]; name: string }>

type Access = keyof typeof ACCESS

// The choices, in the order they're shown
const ACCESS_CHOICES = ["read", "act"] as const satisfies readonly Access[]

// How long a token lasts, as the choices name them, until it's revoked first
const LIFETIMES: { days: ApiTokenLifetime | null; name: string }[] = [
    { days: null, name: "Never" },
    ...API_TOKEN_LIFETIMES.map((days) => ({
        days,
        name: days === 365 ? "In a year" : `In ${days} days`
    }))
]

export function ApiTokens() {
    // The token just made, shown until they're done with it, and never again
    const [made, setMade] = useState<{ name: string; token: string } | null>(
        null
    )

    return (
        <section className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
                <h2 className={sectionHeading}>API tokens</h2>
                <p className="max-w-prose text-pretty text-muted-foreground text-sm">
                    For a script, a scheduled job or another app to call this
                    app's API as you. It sends the token in an{" "}
                    <code className="font-mono text-xs">Authorization</code>{" "}
                    header, and can do what you can, or only read. It can't make
                    tokens, or log anyone in or out.
                </p>
            </div>
            {made !== null && (
                <NewToken
                    name={made.name}
                    token={made.token}
                    onDone={() => setMade(null)}
                />
            )}
            <TokenList />
            <MakeTokenForm onMade={setMade} />
        </section>
    )
}

/**
 * The token just made, with copying it, shown this once: only its hash is
 * kept.
 */
function NewToken({
    name,
    token,
    onDone
}: {
    name: string
    token: string
    onDone: () => void
}) {
    const ids = useId()
    const [copied, setCopied] = useState<"yes" | "failed" | null>(null)

    async function copy() {
        try {
            await navigator.clipboard.writeText(token)
            setCopied("yes")
        } catch (error) {
            console.warn("Copying the token failed", { error })
            setCopied("failed")
        }
    }

    return (
        <div className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-4">
            <div className="flex flex-col gap-1">
                <Label htmlFor={`${ids}-token`}>{name}</Label>
                <p className="text-pretty text-muted-foreground text-sm">
                    Copy it now and keep it somewhere safe: once you leave this
                    page, it isn't shown again.
                </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                    id={`${ids}-token`}
                    readOnly
                    value={token}
                    onFocus={(event) => event.currentTarget.select()}
                    className="h-10 font-mono text-xs"
                />
                <Button
                    type="button"
                    variant="outline"
                    onClick={copy}
                    className="h-10 px-4"
                >
                    {copied === "yes" ? (
                        <Check aria-hidden />
                    ) : (
                        <Copy aria-hidden />
                    )}
                    {copied === "yes" ? "Copied" : "Copy"}
                </Button>
            </div>
            {copied === "failed" && (
                <p role="alert" className="text-destructive text-sm">
                    That didn't copy. Select the token and copy it yourself.
                </p>
            )}
            <button
                type="button"
                className={`${textButton} w-fit`}
                onClick={onDone}
            >
                Done
            </button>
        </div>
    )
}

function TokenList() {
    const tokens = useQuery(accountTokensQuery)
    const list = tokens.data ?? []

    if (tokens.isPending) {
        return (
            <div
                aria-hidden
                className="h-16 animate-pulse rounded-lg bg-muted motion-reduce:animate-none"
            />
        )
    } else if (tokens.isError) {
        return (
            <p role="alert" className="text-destructive text-sm">
                Your tokens didn't load. Try again in a moment.
            </p>
        )
    } else if (list.length === 0) {
        return (
            <p className="rounded-lg border border-dashed px-4 py-3 text-muted-foreground text-sm">
                You haven't made a token yet.
            </p>
        )
    } else {
        return (
            <ul className="flex flex-col divide-y rounded-lg border">
                {list.map((token) => (
                    <TokenRow key={token.id} token={token} />
                ))}
            </ul>
        )
    }
}

/**
 * A token, by its name and its last characters, with Revoke, asked once more
 * in place rather than in a dialog: a script that holds it stops working.
 */
function TokenRow({ token }: { token: AccountApiToken }) {
    const now = useNow()
    const [asking, setAsking] = useState(false)
    const revoke = useMutation(revokeApiToken)
    const ran_out =
        token.expires_at !== null && new Date(token.expires_at) <= now

    return (
        <li className="flex flex-col gap-2 px-4 py-3">
            <div className="flex items-center gap-3">
                <KeyRound
                    aria-hidden
                    className="size-4 shrink-0 text-muted-foreground"
                />
                <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-sm">
                        {token.name}
                        <span className="text-muted-foreground">
                            {token.scopes.includes("act")
                                ? ""
                                : ", reading only"}
                        </span>
                    </span>
                    <span
                        className="text-muted-foreground text-xs tabular-nums"
                        title={`Made ${moment(token.created_at)}`}
                    >
                        <span className="font-mono">api_…{token.preview}</span>
                        {" · "}
                        {token.last_used_at === null
                            ? "never used"
                            : `last used ${since(token.last_used_at, now)}`}
                        {" · "}
                        made {since(token.created_at, now)}
                        {token.expires_at === null ? null : ran_out ? (
                            <span className="text-destructive">
                                {" · "}ran out {since(token.expires_at, now)}
                            </span>
                        ) : (
                            ` · runs out ${day(token.expires_at, now)}`
                        )}
                    </span>
                </div>
                {!asking && (
                    <button
                        type="button"
                        className={textButton}
                        onClick={() => setAsking(true)}
                    >
                        Revoke
                    </button>
                )}
            </div>
            {asking && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pl-7 text-sm">
                    <span className="text-pretty">
                        Revoke {token.name}? Whatever holds it stops working.
                    </span>
                    <Button
                        size="sm"
                        variant="destructive"
                        disabled={revoke.isPending}
                        onClick={() => revoke.mutate({ id: token.id })}
                    >
                        {revoke.isPending ? "Revoking…" : "Revoke it"}
                    </Button>
                    <button
                        type="button"
                        className={textButton}
                        disabled={revoke.isPending}
                        onClick={() => {
                            setAsking(false)
                            revoke.reset()
                        }}
                    >
                        Keep it
                    </button>
                </div>
            )}
            {revoke.error !== null && (
                <p role="alert" className="pl-7 text-destructive text-sm">
                    That didn't revoke: {failureOf(revoke.error).message}. Try
                    again in a moment.
                </p>
            )}
        </li>
    )
}

/** Making one: its name, what it may do, and how long it lasts. */
function MakeTokenForm({
    onMade
}: {
    onMade: (made: { name: string; token: string }) => void
}) {
    const ids = useId()
    const make = useMutation(makeApiToken)
    const [name, setName] = useState("")
    const [access, setAccess] = useState<Access>("read")
    // 90 days unless they choose otherwise, so a token someone forgets
    // about runs out; "Never" is still a choice
    const [lifetime, setLifetime] = useState<ApiTokenLifetime | null>(90)
    const [invalid, setInvalid] = useState(false)

    function submit(event: SubmitEvent<HTMLFormElement>) {
        event.preventDefault()
        // Checked as the API checks it, only to say so at once
        const checked = api_token_name.safeParse(name)
        setInvalid(!checked.success)
        if (checked.success) {
            make.mutate(
                {
                    name: checked.data,
                    scopes: [...ACCESS[access].scopes],
                    expires_in_days: lifetime
                },
                {
                    onSuccess: ({ token, api_token }) => {
                        onMade({ name: api_token.name, token })
                        setName("")
                    }
                }
            )
        }
    }

    const problem = invalid
        ? "Give it a name, at most 80 characters, to know what holds it."
        : make.error !== null
          ? `That didn't make a token: ${failureOf(make.error).message}.`
          : null

    return (
        <form
            noValidate
            onSubmit={submit}
            className="flex flex-col gap-4 rounded-lg border p-4"
        >
            <h3 className="font-medium text-sm">Make a token</h3>
            <div className="flex flex-col gap-2">
                <Label htmlFor={`${ids}-name`}>Name</Label>
                <Input
                    id={`${ids}-name`}
                    value={name}
                    placeholder="Nightly export"
                    aria-invalid={invalid}
                    aria-describedby={`${ids}-problem`}
                    onChange={(event) => {
                        setName(event.target.value)
                        setInvalid(false)
                        make.reset()
                    }}
                    className="h-10 sm:max-w-sm"
                />
            </div>
            <Choice
                legend="It may"
                options={ACCESS_CHOICES.map((key) => ({
                    key,
                    name: ACCESS[key].name
                }))}
                chosen={access}
                onChoose={setAccess}
            />
            <Choice
                legend="It runs out"
                options={LIFETIMES.map(({ days, name }) => ({
                    key: days,
                    name
                }))}
                chosen={lifetime}
                onChoose={setLifetime}
            />
            <p
                id={`${ids}-problem`}
                role={problem === null ? undefined : "alert"}
                className="text-destructive text-sm empty:hidden"
            >
                {problem}
            </p>
            <Button
                type="submit"
                disabled={make.isPending}
                className="h-10 w-fit px-4"
            >
                {make.isPending ? "Making…" : "Make token"}
            </Button>
        </form>
    )
}

/** Choices side by side, one pressed, as the People screen's roles are. */
function Choice<Key extends string | number | null>({
    legend,
    options,
    chosen,
    onChoose
}: {
    legend: string
    options: { key: Key; name: string }[]
    chosen: Key
    onChoose: (key: Key) => void
}) {
    return (
        <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 font-medium text-sm">{legend}</legend>
            <div className="inline-flex w-fit flex-wrap rounded-lg border bg-muted p-0.5">
                {options.map((option) => (
                    <button
                        key={String(option.key)}
                        type="button"
                        aria-pressed={option.key === chosen}
                        onClick={() => onChoose(option.key)}
                        className="rounded-md px-2.5 py-1 font-medium text-muted-foreground text-xs transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-xs"
                    >
                        {option.name}
                    </button>
                ))}
            </div>
        </fieldset>
    )
}
