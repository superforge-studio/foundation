import { createFileRoute, Navigate } from "@tanstack/react-router"
import { useSession } from "@/frontend/queries/auth"
import { isInternal } from "@/utilities/schemas/users"

export const Route = createFileRoute("/dashboard/")({
    component: Start
})

// Where /dashboard opens: the workflows for the business's own people, and
// everyone else's account (route.tsx has logged them in by now)
function Start() {
    const session = useSession()
    if (session.status === "logged-in" && isInternal(session.user.role)) {
        return <Navigate to="/dashboard/workflows" replace />
    } else {
        return <Navigate to="/dashboard/account" replace />
    }
}
