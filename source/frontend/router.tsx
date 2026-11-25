import { QueryClient } from "@tanstack/react-query"
import { createRouter as createTanStackRouter } from "@tanstack/react-router"
import { NotFound } from "@/frontend/components/states/not-found"
import { routeTree } from "./routeTree.gen"

// A tab open across a deploy asks for a page's code the new build doesn't
// have: load the page again for the new build's, rather than leave its
// navigation failing until a reload. Only once the page has been open a
// while, so code missing from the build itself can't reload it over and
// over, and with nothing kept on the device to tell
const RELOAD_AFTER_MS = 10_000

if (typeof window !== "undefined") {
    window.addEventListener("vite:preloadError", (event) => {
        if (performance.now() > RELOAD_AFTER_MS) {
            event.preventDefault()
            window.location.reload()
        }
    })
}

export function getRouter() {
    return createTanStackRouter({
        routeTree,
        // One query cache per router: per request on the server (the
        // prerender), once for the life of the page in the browser. It's on
        // the context so a route's loader can read it; `__root.tsx`
        // provides it to components.
        context: { queryClient: new QueryClient() },
        scrollRestoration: true,
        defaultPreload: "intent",
        defaultNotFoundComponent: NotFound
    })
}

declare module "@tanstack/react-router" {
    interface Register {
        router: ReturnType<typeof getRouter>
    }
}
