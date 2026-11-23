import { createFileRoute, Navigate } from "@tanstack/react-router"
import { SECTIONS } from "@/frontend/components/dashboard/shell"
import { useSession } from "@/frontend/queries/auth"
import { allows } from "@/utilities/permissions"

export const Route = createFileRoute("/admin/")({
    component: Start
})

// Where /admin opens: the first section someone's role may read, or their
// account when it may read none (route.tsx has logged them in by now)
function Start() {
    const session = useSession()
    const first =
        session.status === "logged-in"
            ? SECTIONS.find((section) =>
                  allows(session.permissions, section.area, "read")
              )
            : undefined
    if (first === undefined) {
        return <Navigate to="/admin/account" replace />
    } else {
        return <Navigate to={first.to} replace />
    }
}
