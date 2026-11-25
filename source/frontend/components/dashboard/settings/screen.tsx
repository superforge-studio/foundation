import type { ComponentType } from "react"
import { useSession } from "@/frontend/queries/auth"
import { type Area, allows, type Permissions } from "@/utilities/permissions"
import { APP_SETTINGS_PARTS } from "../app"
import { NotPermitted } from "../shell"
import { Team } from "./team"

// Settings, which the gear beside who's logged in opens: what the app runs
// on, on one page, a part each, each shown to a role that may read its
// area. The template's part is the team, as the app's code lists it, and
// this app's own follow it (../app.ts). Most of it is set in the app's
// code, so a change here is a prompt for Claude Code (../prompt.tsx), and
// the API answers each part only to a role that may read it.

/** A part of Settings, beside the team. */
export type SettingsPart = {
    /** Its own name, which keeps it apart from the others, like `team` */
    key: string
    /** The area a role reads to see it (utilities/permissions/) */
    area: Area
    /** What it draws: a section of its own, which asks the API for its data */
    Part: ComponentType
}

// Settings' parts, in order: the template's, then this app's own
const SETTINGS: readonly SettingsPart[] = [
    { key: "team", area: "team", Part: Team },
    ...APP_SETTINGS_PARTS
]

/**
 * The parts of Settings `permissions` may read. With none, there's no
 * gear, and Settings says why.
 */
export function settingsShownTo(permissions: Permissions) {
    return SETTINGS.filter((part) => allows(permissions, part.area, "read"))
}

/** The screen: each part someone's role may read, or why they see none. */
export function SettingsScreen() {
    const session = useSession()
    if (session.status !== "logged-in") {
        // routes/admin/route.tsx draws the way in until someone is
        return null
    }
    const parts = settingsShownTo(session.permissions)
    if (parts.length === 0) {
        return <NotPermitted name="Settings" />
    }
    return (
        <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto flex max-w-4xl flex-col gap-10 px-4 py-6 sm:px-8 sm:py-8">
                <header className="flex flex-col gap-1">
                    <h1 className="text-balance font-heading font-semibold text-2xl tracking-tight">
                        Settings
                    </h1>
                    <p className="max-w-prose text-pretty text-muted-foreground text-sm">
                        What the app runs on, as its code sets it. A change here
                        is a prompt for Claude Code, and a pull request you
                        merge.
                    </p>
                </header>
                {parts.map(({ key, Part }) => (
                    <Part key={key} />
                ))}
            </div>
        </div>
    )
}
