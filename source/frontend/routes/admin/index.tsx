import { createFileRoute } from "@tanstack/react-router"
import { OverviewScreen } from "@/frontend/components/dashboard/overview"

/**
 * Where /admin opens: the Overview, the admin's home, which everyone on
 * the team sees whatever their role, saying the dashboard is the
 * business's to build, and how (components/dashboard/overview.tsx).
 */
export const Route = createFileRoute("/admin/")({
    head: () => ({ meta: [{ title: "Overview · Admin" }] }),
    component: OverviewScreen
})
