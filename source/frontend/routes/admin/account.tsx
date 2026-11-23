import { createFileRoute } from "@tanstack/react-router"
import { AccountPanel } from "@/frontend/components/dashboard/account"
import { SinglePane } from "@/frontend/components/dashboard/shell"
import { useSession } from "@/frontend/queries/auth"

/** Someone's own account, whatever their role: one screen of the admin. */
export const Route = createFileRoute("/admin/account")({
    head: () => ({ meta: [{ title: "Your account · Admin" }] }),
    component: Account
})

function Account() {
    const session = useSession()
    if (session.status !== "logged-in") {
        // route.tsx draws the way in until someone is
        return null
    }
    const { user, permissions } = session
    return (
        <SinglePane>
            <header className="flex flex-col gap-2">
                <h1 className="text-balance font-heading font-semibold text-2xl tracking-tight">
                    Your account
                </h1>
                <p className="text-pretty text-muted-foreground">
                    Logged in as {user.email}.
                </p>
            </header>
            <AccountPanel key={user.id} user={user} permissions={permissions} />
        </SinglePane>
    )
}
