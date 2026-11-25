import type { ReactNode } from "react"
import { BusinessMark } from "@/frontend/components/site/business-mark"
import { LoginForm } from "@/frontend/components/site/login-form"

// What the admin shows before its frame: while it finds out who's logged
// in, and the way in for someone who isn't. Each shows at the address that
// was opened, never sending anyone elsewhere, so logging in lands them
// where they meant to go.

/** The dashboard while it finds out who's logged in: its shape, not a spinner. */
export function DashboardLoading() {
    return (
        <div aria-hidden className="flex h-dvh flex-col md:flex-row">
            <div className="h-24 shrink-0 border-b bg-sidebar md:h-auto md:w-60 md:border-r md:border-b-0" />
            <div className="flex flex-1 flex-col gap-4 p-8">
                <div className="h-8 w-1/2 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
                <div className="h-48 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
            </div>
        </div>
    )
}

/** Someone who opens the dashboard without logging in: the way in, here. */
export function DashboardLogin({ heading }: { heading: string }) {
    return (
        <Notice heading={heading}>
            <p className="text-pretty text-muted-foreground leading-relaxed">
                Enter your email and we'll send you a code and a link. There's
                no password.
            </p>
            <LoginForm />
        </Notice>
    )
}

// A page of its own, under the business's mark: a heading and what's under it
function Notice({
    heading,
    children
}: {
    heading: string
    children: ReactNode
}) {
    return (
        <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-10 px-5 py-6 sm:py-10">
            <header>
                <BusinessMark />
            </header>
            <section className="flex flex-col gap-6 sm:mt-10">
                <h1 className="text-balance font-heading font-semibold text-3xl tracking-tight">
                    {heading}
                </h1>
                {children}
            </section>
        </main>
    )
}
