import {
    createFileRoute,
    Navigate,
    Outlet,
    useLocation
} from "@tanstack/react-router"
import { DashboardBar } from "@/frontend/components/dashboard/shell"
import { BusinessMark } from "@/frontend/components/site/business-mark"
import { LoginForm } from "@/frontend/components/site/login-form"
import { useSession } from "@/frontend/queries/auth"
import { isInternal } from "@/utilities/schemas/users"

/**
 * The dashboard, behind login: a bar across the top, and the screen
 * under it, each with its own address so Back, refresh and a shared link
 * keep it. The business's own people (internal roles) get the workflows,
 * the people and their account; everyone else only their account. It's
 * drawn in the browser, never prerendered (vite.config.ts leaves
 * /dashboard out), since it's different for everyone, and the API decides
 * who may see what whatever the page shows (`internalOnly`).
 */
export const Route = createFileRoute("/dashboard")({
    ssr: false,
    head: () => ({
        meta: [{ title: "Dashboard" }, { name: "robots", content: "noindex" }]
    }),
    pendingComponent: Loading,
    component: Dashboard
})

function Dashboard() {
    const session = useSession()
    const { pathname } = useLocation()
    if (session.status === "loading") {
        return <Loading />
    } else if (session.status === "logged-out") {
        return <LoggedOut />
    }

    const internal = isInternal(session.user.role)
    if (!internal && pathname !== "/dashboard/account") {
        // Everyone else's dashboard is their account
        return <Navigate to="/dashboard/account" replace />
    }
    // `data-private`: the dashboard shows people's names and the
    // business's own data, so a click here never sends the text it showed
    return (
        <div data-private className="flex h-dvh min-h-[32rem] flex-col">
            <DashboardBar user={session.user} internal={internal} />
            <Outlet />
        </div>
    )
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

// Someone who opens the dashboard without logging in: the way in, here,
// so they land where they meant to go
function LoggedOut() {
    return (
        <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-10 px-5 py-6 sm:py-10">
            <header>
                <BusinessMark />
            </header>
            <section className="flex flex-col gap-6 sm:mt-10">
                <div className="flex flex-col gap-2">
                    <h1 className="text-balance font-heading font-semibold text-3xl tracking-tight">
                        Log in to your dashboard
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
