import { useMutation, useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { Button } from "@/frontend/components/primitives/button"
import { BusinessMark } from "@/frontend/components/site/business-mark"
import { LoginForm } from "@/frontend/components/site/login-form"
import {
    allowAgent,
    connectRequestQuery,
    denyAgent
} from "@/frontend/queries/agents"
import { useSession } from "@/frontend/queries/auth"
import { failureOf } from "@/frontend/queries/failures"
import type { AgentScope } from "@/utilities/schemas/agents"
import { isInternal } from "@/utilities/schemas/users"

/**
 * The Allow page: where Claude, connecting to the app's MCP, sends someone
 * on the business's team to let it in (backend/agents/). It shows what
 * Claude asked for, and sends the browser back to Claude once they allow
 * or decline it. Drawn in the browser, never prerendered (vite.config.ts
 * leaves /connect out), since it's someone's own request. Logged out, it
 * logs them in here, by the code the email holds, so they never leave
 * the window Claude opened.
 */
export const Route = createFileRoute("/connect/$request_id")({
    ssr: false,
    head: () => ({
        meta: [
            { title: "Connect Claude" },
            { name: "robots", content: "noindex" }
        ]
    }),
    component: Connect
})

function Connect() {
    const { request_id } = Route.useParams()
    const session = useSession()
    if (session.status === "loading") {
        return <Frame>{null}</Frame>
    } else if (session.status === "logged-out") {
        return (
            <Frame>
                <Heading
                    title="Log in to connect Claude"
                    lead="Enter your email, then type the code we send you here. Stay on this page: Claude is waiting on it."
                />
                <LoginForm />
            </Frame>
        )
    } else if (!isInternal(session.user.role)) {
        return (
            <Frame>
                <Heading
                    title="Only the team can connect Claude"
                    lead={`You're logged in as ${session.user.email}, who isn't on the business's team. Log in as someone who is.`}
                />
            </Frame>
        )
    } else {
        return (
            <Frame>
                <Request request_id={request_id} email={session.user.email} />
            </Frame>
        )
    }
}

function Request({ request_id, email }: { request_id: string; email: string }) {
    const request = useQuery(connectRequestQuery(request_id))
    const allow = useMutation(allowAgent)
    const deny = useMutation(denyAgent)
    const back = (redirect_to: string) => window.location.assign(redirect_to)
    const pending = allow.isPending || deny.isPending || allow.isSuccess
    const failed = allow.error ?? deny.error

    if (request.isPending) {
        return (
            <div
                aria-hidden
                className="h-48 animate-pulse rounded-lg bg-muted motion-reduce:animate-none"
            />
        )
    } else if (request.isError) {
        const gone = failureOf(request.error).reason === "not-found"
        return (
            <Heading
                title={gone ? "This request has run out" : "That didn't load"}
                lead={
                    gone
                        ? "It was answered already, or waited longer than ten minutes. Ask Claude to connect again."
                        : "Try again in a minute."
                }
            />
        )
    }

    const { client_name, scopes } = request.data
    const allowing = (allowed: AgentScope[]) =>
        allow.mutate({ request_id, scopes: allowed }, { onSuccess: back })
    return (
        <>
            <Heading
                title={`Let ${client_name} in?`}
                lead={`${client_name} will act as you, ${email}: it can see what you see here${scopes.includes("act") ? ", and if you let it, change what you can change" : ""}. It can't log anyone in or out. You can disconnect it from your account page whenever you like.`}
            />
            <div className="flex flex-col gap-3 sm:flex-row">
                {scopes.includes("act") && (
                    <Button
                        className="h-11 px-5"
                        disabled={pending}
                        onClick={() => allowing(["read", "act"])}
                    >
                        Allow
                    </Button>
                )}
                {scopes.includes("read") && (
                    <Button
                        variant={scopes.includes("act") ? "outline" : "default"}
                        className="h-11 px-5"
                        disabled={pending}
                        onClick={() => allowing(["read"])}
                    >
                        {scopes.includes("act")
                            ? "Allow reading only"
                            : "Allow"}
                    </Button>
                )}
                <Button
                    variant="ghost"
                    className="h-11 px-5"
                    disabled={pending}
                    onClick={() =>
                        deny.mutate({ request_id }, { onSuccess: back })
                    }
                >
                    Don't allow
                </Button>
            </div>
            {failed !== null && (
                <p role="alert" className="text-destructive text-sm">
                    That didn't go through: {failureOf(failed).message}
                </p>
            )}
        </>
    )
}

function Heading({ title, lead }: { title: string; lead: string }) {
    return (
        <div className="flex flex-col gap-2">
            <h1 className="text-balance font-heading font-semibold text-3xl tracking-tight">
                {title}
            </h1>
            <p className="text-pretty text-muted-foreground leading-relaxed">
                {lead}
            </p>
        </div>
    )
}

function Frame({ children }: { children: ReactNode }) {
    return (
        <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-10 px-5 py-6 sm:py-10">
            <header>
                <BusinessMark />
            </header>
            <section className="flex flex-col gap-6 sm:mt-10">
                {children}
            </section>
        </main>
    )
}
