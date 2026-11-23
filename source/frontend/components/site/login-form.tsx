import { useMutation } from "@tanstack/react-query"
import { cn } from "cn"
import { CircleAlert } from "lucide-react"
import { type SubmitEvent, useId, useState } from "react"
import { Button } from "@/frontend/components/primitives/button"
import { Input } from "@/frontend/components/primitives/input"
import { Label } from "@/frontend/components/primitives/label"
import {
    type SentLogin,
    startLogin,
    verifyLogin
} from "@/frontend/queries/auth"
import { failureOf } from "@/frontend/queries/failures"
import { email_address, login_code } from "@/utilities/schemas/auth"
import type { ApiFailure } from "@/utilities/schemas/failures"

// Secondary actions are text buttons with a thin underline
const textButton =
    "font-medium text-foreground underline decoration-foreground/40 underline-offset-4 transition-colors hover:decoration-foreground focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"

/**
 * Logging in, in two steps: an email address, which Infra sends a six-digit
 * code and a link to, then the code. The link logs in on its own, on
 * /login (routes/login.tsx). `onLoggedIn` runs once the code has.
 */
export function LoginForm({
    onLoggedIn,
    className
}: {
    onLoggedIn?: () => void
    className?: string
}) {
    const [sent, setSent] = useState<SentLogin | null>(null)
    if (sent === null) {
        return <EmailStep className={className} onSent={setSent} />
    } else {
        return (
            <CodeStep
                sent={sent}
                className={className}
                onSentAgain={setSent}
                onRestart={() => setSent(null)}
                onLoggedIn={onLoggedIn}
            />
        )
    }
}

function EmailStep({
    className,
    onSent
}: {
    className?: string
    onSent: (sent: SentLogin) => void
}) {
    const ids = useId()
    const start = useMutation(startLogin)
    const [invalid, setInvalid] = useState(false)
    const problem = invalid
        ? "Enter your email address, like you@example.com."
        : start.error === null
          ? null
          : whatWentWrong(failureOf(start.error))
    const cause =
        invalid || start.error === null
            ? undefined
            : failureOf(start.error).cause

    function submit(event: SubmitEvent<HTMLFormElement>) {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        // Checked as the API checks it, only to say so at once
        const email = email_address.safeParse(form.get("email"))
        setInvalid(!email.success)
        if (email.success) {
            start.mutate({ email: email.data }, { onSuccess: onSent })
        }
    }

    return (
        <form
            noValidate
            onSubmit={submit}
            className={cn("flex flex-col gap-3", className)}
        >
            <Label htmlFor={`${ids}-email`}>Email</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                    id={`${ids}-email`}
                    type="email"
                    name="email"
                    required
                    autoComplete="email"
                    placeholder="you@example.com"
                    aria-invalid={problem !== null}
                    aria-describedby={`${ids}-problem`}
                    className="h-10 sm:flex-1"
                />
                <Button
                    type="submit"
                    disabled={start.isPending}
                    className="h-10 px-4"
                >
                    {start.isPending ? "Sending…" : "Email me a code"}
                </Button>
            </div>
            <Problem id={`${ids}-problem`} text={problem} />
            <TeamCause cause={cause} />
        </form>
    )
}

function CodeStep({
    sent,
    className,
    onSentAgain,
    onRestart,
    onLoggedIn
}: {
    sent: SentLogin
    className?: string
    onSentAgain: (sent: SentLogin) => void
    onRestart: () => void
    onLoggedIn?: () => void
}) {
    const ids = useId()
    const [code, setCode] = useState("")
    const [invalid, setInvalid] = useState(false)
    const [resent, setResent] = useState(false)
    const verify = useMutation(verifyLogin)
    const again = useMutation(startLogin)
    const failed = verify.error ?? again.error
    const problem = invalid
        ? "Enter the six digits from the email."
        : failed === null
          ? null
          : whatWentWrong(failureOf(failed))
    const cause =
        invalid || failed === null ? undefined : failureOf(failed).cause

    function submit(event: SubmitEvent<HTMLFormElement>) {
        event.preventDefault()
        const checked = login_code.safeParse(code)
        setInvalid(!checked.success)
        if (checked.success) {
            verify.mutate(
                { email: sent.email, code: checked.data },
                { onSuccess: () => onLoggedIn?.() }
            )
        }
    }

    function sendAgain() {
        again.mutate(
            { email: sent.email },
            {
                onSuccess: (sent_again) => {
                    setCode("")
                    setResent(true)
                    verify.reset()
                    onSentAgain(sent_again)
                }
            }
        )
    }

    return (
        <form
            noValidate
            onSubmit={submit}
            className={cn("flex flex-col gap-3", className)}
        >
            <p role="status" className="text-pretty leading-relaxed">
                We sent a code to{" "}
                <span className="font-medium">{sent.email}</span>.{" "}
                {sent.with_link
                    ? "Enter it here, or open the link in the email."
                    : "Enter it here."}
            </p>
            <Label htmlFor={`${ids}-code`}>Six-digit code</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                    id={`${ids}-code`}
                    required
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={7}
                    placeholder="123456"
                    value={code}
                    onChange={(event) =>
                        setCode(event.target.value.replace(/[^\d ]/g, ""))
                    }
                    aria-invalid={problem !== null}
                    aria-describedby={`${ids}-problem`}
                    className="h-10 font-mono text-lg tracking-[0.25em] tabular-nums sm:flex-1"
                />
                <Button
                    type="submit"
                    disabled={verify.isPending}
                    className="h-10 px-4"
                >
                    {verify.isPending ? "Checking…" : "Log in"}
                </Button>
            </div>
            <Problem id={`${ids}-problem`} text={problem} />
            <TeamCause cause={cause} />
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-muted-foreground text-sm">
                <button
                    type="button"
                    className={textButton}
                    disabled={again.isPending}
                    onClick={sendAgain}
                >
                    {again.isPending
                        ? "Sending…"
                        : resent
                          ? "Sent. Send another"
                          : "Send a new code"}
                </button>
                <button
                    type="button"
                    className={textButton}
                    onClick={onRestart}
                >
                    Use a different email
                </button>
            </div>
            {sent.development !== null && (
                <DevelopmentNote {...sent.development} />
            )}
        </form>
    )
}

// A dev server emails nothing: the API hands back what the email would
// hold, and this shows it where the email would be. A build never gets it.
function DevelopmentNote({
    code,
    link
}: {
    code: string
    link: string | null
}) {
    return (
        <p className="rounded-lg border border-dashed px-3 py-2.5 text-muted-foreground text-sm leading-relaxed">
            <span className="font-medium text-foreground">Dev server:</span> no
            email goes out. The code is{" "}
            <span className="font-medium font-mono text-foreground tabular-nums">
                {code}
            </span>
            {link === null ? (
                "."
            ) : (
                <>
                    , or{" "}
                    <a href={link} className={textButton}>
                        open the link the email holds
                    </a>
                    .
                </>
            )}
        </p>
    )
}

/** What to tell the visitor when logging in failed, by the API's reason. */
export function whatWentWrong(failure: ApiFailure) {
    switch (failure.reason) {
        case "invalid":
            return "Check what you entered and try again."
        case "rate-limited": {
            // A minute or less: a code went to this address just now, and
            // is on its way
            const seconds = failure.retry_after ?? 3600
            if (seconds <= 60) {
                return "We sent a code less than a minute ago. Check your inbox, or ask again in a minute."
            } else {
                const minutes = Math.ceil(seconds / 60)
                return `That's a lot of codes for now. Try again in ${minutes} minutes.`
            }
        }
        case "not-sent":
            return "The email didn't go out. Check the address and try again."
        case "wrong-code":
            return "That code isn't right. Use the one in the newest email."
        case "no-code":
            return "That code has stopped working. Send a new one."
        case "no-link":
            return "That link has expired or was already used. Enter your email and we'll send a new one."
        default:
            return "Login isn't working right now. Try again in a few minutes."
    }
}

/**
 * Why logging in failed, in Infra's words, for the business's own people
 * and a dev server, which the API answers them alone as `cause`, under
 * what a visitor is told
 */
export function TeamCause({ cause }: { cause: string | undefined }) {
    if (cause === undefined) {
        return null
    } else {
        return (
            <p className="text-pretty text-muted-foreground text-sm leading-relaxed">
                <span className="font-medium text-foreground">
                    For the team:
                </span>{" "}
                {cause}
            </p>
        )
    }
}

function Problem({ id, text }: { id: string; text: string | null }) {
    if (text === null) {
        return <p id={id} hidden />
    } else {
        return (
            <p
                id={id}
                role="alert"
                className="flex items-start gap-1.5 font-medium text-destructive text-sm"
            >
                <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                {text}
            </p>
        )
    }
}
