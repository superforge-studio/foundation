import { createFileRoute } from "@tanstack/react-router"
import { AccountPanel } from "@/frontend/components/dashboard/account"
import { SinglePane } from "@/frontend/components/dashboard/shell"
import { useSession } from "@/frontend/queries/auth"
import { isInternal } from "@/utilities/schemas/users"

/**
 * Someone's own account: the whole of the dashboard for a customer, and one
 * screen of it for the business's own people.
 */
export const Route = createFileRoute("/dashboard/account")({
    head: () => ({ meta: [{ title: "Your account · Dashboard" }] }),
    component: Account
})

function Account() {
    const session = useSession()
    if (session.status !== "logged-in") {
        // route.tsx draws the way in until someone is
        return null
    }
    const { user } = session
    return (
        <SinglePane>
            <header className="flex flex-col gap-2">
                <h1 className="text-balance font-heading font-semibold text-2xl tracking-tight">
                    Your account
                </h1>
                <p className="text-pretty text-muted-foreground">
                    {isInternal(user.role)
                        ? "You're one of the business's own, so you see its workflows and its people too."
                        : `Logged in as ${user.email}.`}
                </p>
            </header>
            <AccountPanel key={user.id} user={user} />
        </SinglePane>
    )
}
