import { createFileRoute } from "@tanstack/react-router"
import { SettingsScreen } from "@/frontend/components/dashboard/settings/screen"

/**
 * What the app runs on, which the gear beside who's logged in brings
 * someone to: a part each, each for a role that may read its area. The
 * template's is the team, as the app's code lists it, and this app's own
 * follow it (components/dashboard/app.ts).
 */
export const Route = createFileRoute("/admin/settings")({
    head: () => ({ meta: [{ title: "Settings · Admin" }] }),
    component: SettingsScreen
})
