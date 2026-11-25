import { cn } from "cn"
import { useEffect, useState } from "react"
import type { TeamRole } from "@/backend/auth/access"
import { roleName } from "./words"

// Small marks the dashboard's screens share

/**
 * A role, as a small mark: an owner's filled, any other role's outlined,
 * and someone taken off the team dashed.
 */
export function RoleMark({ role }: { role: TeamRole | null }) {
    return (
        <span
            className={cn(
                "inline-flex h-[1.375rem] w-fit shrink-0 items-center rounded-md border px-2 font-medium text-xs",
                role === null
                    ? "border-muted-foreground/50 border-dashed text-muted-foreground"
                    : role === "owner"
                      ? "border-transparent bg-foreground text-background"
                      : "text-foreground"
            )}
        >
            {role === null ? "Taken off" : roleName(role)}
        </span>
    )
}

/** Draws again every so often, so "4 min ago" stays true. */
export function useNow(every = 15_000) {
    const [now, setNow] = useState(() => new Date())
    useEffect(() => {
        const timer = setInterval(() => setNow(new Date()), every)
        return () => clearInterval(timer)
    }, [every])
    return now
}
