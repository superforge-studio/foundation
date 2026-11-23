import { Link } from "@tanstack/react-router"
import { BusinessMark } from "@/frontend/components/site/business-mark"

/**
 * An address that's no page, outside the admin, with the business's mark
 * over it, as its other pages have, and the way home. Under /admin, the
 * admin answers in its own frame (`AdminNotFound`).
 */
export function NotFound() {
    return (
        <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-10 px-6 py-6 sm:py-10">
            <header>
                <BusinessMark />
            </header>
            <div className="flex flex-1 flex-col justify-center gap-4 pb-24">
                <p className="text-muted-foreground text-sm">404</p>
                <h1 className="text-balance font-heading font-semibold text-3xl tracking-tight">
                    There's nothing here.
                </h1>
                <Link
                    to="/"
                    className="w-fit text-sm underline underline-offset-4"
                >
                    Back to the home page
                </Link>
            </div>
        </main>
    )
}
