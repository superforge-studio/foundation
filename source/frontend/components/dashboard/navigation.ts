import { LayoutDashboard } from "lucide-react"
import type { Area } from "@/utilities/permissions"
import { APP_NAVIGATION } from "./app"
import type { Navigation } from "./shell"

// The admin's sections, which its sidebar moves between. They're apart
// from the frame (./shell.tsx), which everything in this folder draws
// with, so a screen or a part of Settings that imports the frame never
// imports this app's own sections back through it (./app.ts).

/**
 * The admin's sections: the Overview, where /admin opens
 * (routes/admin/index.tsx), then this app's own, in their groups
 * (./app.ts). Settings and the account aren't sections: they're the gear
 * and the name at the sidebar's foot.
 */
export const ADMIN_NAVIGATION: Navigation = [
    {
        sections: [
            {
                to: "/admin",
                name: "Overview",
                icon: LayoutDashboard,
                exact: true
            }
        ]
    },
    ...APP_NAVIGATION
]

/**
 * The admin's section an address is in, and so the area it shows: the
 * section with an area whose address it is or starts with. Undefined for
 * an address in none, like the Overview's, Settings' (which checks its
 * own parts, ./settings/screen.tsx) or the account's.
 */
export function adminSectionAt(
    pathname: string
): { name: string; area: Area } | undefined {
    for (const { sections } of ADMIN_NAVIGATION) {
        for (const section of sections) {
            if (
                section.area !== undefined &&
                (pathname === section.to ||
                    pathname.startsWith(`${section.to}/`))
            ) {
                return { name: section.name, area: section.area }
            }
        }
    }
    return undefined
}
