import { createFileRoute, Outlet } from "@tanstack/react-router"
import {
    AdminNotFound,
    DashboardBar
} from "@/frontend/components/dashboard/shell"
import { BusinessMark } from "@/frontend/components/site/business-mark"
import { LoginForm } from "@/frontend/components/site/login-form"
import { useSession } from "@/frontend/queries/auth"

/**
 * The admin, behind login, for the team listed in code
 * (backend/auth/access.ts), the only people who log in: a bar across the
 * top, with the sections someone's role may read, and the screen under it,
 * each with its own address so Back, refresh and a shared link keep it. An
 * address under it that's no page is answered in the same frame
 * (`AdminNotFound`). It's drawn in the browser, never prerendered
 * (vite.config.ts leaves /admin out), since it's different for everyone,
 * and the API decides who may see what whatever the page shows
 * (`permitted`, backend/auth/logged-in.ts).
 */
export const Route = createFileRoute("/admin")({
    ssr: false,
    head: () => ({
        meta: [{ title: "Admin" }, { name: "robots", content: "noindex" }]
    }),
    pendingComponent: Loading,
    notFoundComponent: AdminNotFound,
    component: Admin
})

function Admin() {
    const session = useSession()
    if (session.status === "loading") {
        return <Loading />
    } else if (session.status === "logged-out") {
        return <LoggedOut />
    } else {
        // `data-private`: the admin shows people's names and the business's
        // own data, so a click here never sends the text it showed
        return (
            <div data-private className="flex h-dvh min-h-[32rem] flex-col">
                <DashboardBar
                    user={session.user}
                    permissions={session.permissions}
                />
                <Outlet />
            </div>
        )
    }
}

function Loading() {
    return (
        <div aria-hidden className="flex h-dvh flex-col">
            <div className="h-14 border-b bg-sidebar" />
            <div className="flex flex-1">
                <div className="hidden w-[22rem] border-r bg-sidebar md:block" />
                <div className="flex flex-1 flex-col gap-4 p-8">
                    <div className="h-8 w-1/2 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
                    <div className="h-48 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
                </div>
            </div>
        </div>
    )
}

// Someone who opens the admin without logging in: the way in, here, so
// they land where they meant to go
function LoggedOut() {
    return (
        <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-10 px-5 py-6 sm:py-10">
            <header>
                <BusinessMark />
            </header>
            <section className="flex flex-col gap-6 sm:mt-10">
                <div className="flex flex-col gap-2">
                    <h1 className="text-balance font-heading font-semibold text-3xl tracking-tight">
                        Log in to the admin
                    </h1>
                    <p className="text-pretty text-muted-foreground leading-relaxed">
                        Enter your email and we'll send you a code and a link.
                        There's no password.
                    </p>
                </div>
                <LoginForm />
            </section>
        </main>
    )
}
