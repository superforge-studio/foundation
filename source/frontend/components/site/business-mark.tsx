import { Link } from "@tanstack/react-router"
import { cn } from "cn"

/**
 * The business's mark, back to the home page: its logo and its name, at the
 * top of the login page and the dashboard. START-HERE.md puts the
 * business's own here, in place of the favicon and "Your business".
 */
export function BusinessMark({ className }: { className?: string }) {
    return (
        <Link
            to="/"
            className={cn(
                "flex w-fit items-center gap-2.5 rounded-sm focus-visible:outline-2 focus-visible:outline-ring",
                className
            )}
        >
            {/* The favicon, which follows the device's theme itself */}
            <img src="/favicon.svg" alt="" className="size-5" />
            <span className="font-medium text-sm">Your business</span>
        </Link>
    )
}
