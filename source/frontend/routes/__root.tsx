import { type QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
    createRootRouteWithContext,
    HeadContent,
    Outlet,
    Scripts,
    useRouter
} from "@tanstack/react-router"
import { type ReactNode, useEffect } from "react"
import { ConsentBanner } from "@/frontend/components/site/consent-banner"
import { Toolbar } from "@/frontend/components/toolbar/toolbar"
import appCss from "@/frontend/styles.css?url"
import { startVisitors } from "@/frontend/visitors"
import { SETTINGS } from "@/utilities/settings"
import { GENERATOR } from "@/utilities/template"

export const Route = createRootRouteWithContext<{
    queryClient: QueryClient
}>()({
    head: () => ({
        meta: [
            { charSet: "utf-8" },
            // The Superforge template this site was built on, in its
            // source only, never on the page. Keep it: it's what Superforge
            // asks in return for the template (utilities/template.ts)
            { name: "generator", content: GENERATOR },
            {
                name: "viewport",
                content: "width=device-width, initial-scale=1"
            },
            // The business's name and what it does, for a page that sets
            // neither: the app's settings (utilities/settings/), which
            // START-HERE.md sets
            { title: SETTINGS.site_title },
            { name: "description", content: SETTINGS.site_description }
        ],
        links: [
            { rel: "stylesheet", href: appCss },
            { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" }
        ]
    }),
    shellComponent: RootDocument,
    component: Root
})

// Every page's queries share the router's query cache (router.tsx). Every
// page records what its visitors view, click and run into, in the app's own
// database, from an effect, so only ever in the browser, and asks first,
// in the banner, when the server says to (frontend/visitors/). Whoever's logged in gets the toolbar on every page,
// to comment on what they see, wherever Infra keeps what they file
// (components/toolbar/).
function Root() {
    const { queryClient } = Route.useRouteContext()
    const router = useRouter()
    useEffect(() => startVisitors(router), [router])
    return (
        <QueryClientProvider client={queryClient}>
            <Outlet />
            <ConsentBanner />
            <Toolbar />
        </QueryClientProvider>
    )
}

function RootDocument({ children }: { children: ReactNode }) {
    return (
        <html lang="en">
            <head>
                <HeadContent />
            </head>
            <body className="min-h-screen antialiased">
                {children}
                <Scripts />
            </body>
        </html>
    )
}
