import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router"
import {
    DashboardLoading,
    DashboardLogin
} from "@/frontend/components/dashboard/gate"
import {
    ADMIN_NAVIGATION,
    adminSectionAt
} from "@/frontend/components/dashboard/navigation"
import { settingsShownTo } from "@/frontend/components/dashboard/settings/screen"
import {
    AdminNotFound,
    DashboardFrame,
    NotPermitted
} from "@/frontend/components/dashboard/shell"
import { roleName } from "@/frontend/components/dashboard/words"
import { useSession } from "@/frontend/queries/auth"
import { allows } from "@/utilities/permissions"

/**
 * The admin, behind login, for the team listed in code
 * (backend/auth/access.ts), the only people who log in: a sidebar down the
 * left (a bar across the top on a phone) with the sections someone's role
 * may read, and the screen beside it, each with its own address so Back,
 * refresh and a shared link keep it. It opens on the Overview (index.tsx).
 * Who's logged in, at the sidebar's foot, opens their account here
 * (account.tsx), and the gear beside them opens Settings (settings.tsx),
 * for a role that may read a part of it, the team as the template ships.
 * A section whose area their role can't read shows `NotPermitted`, and an
 * address under it that's no page is answered in the same frame
 * (`AdminNotFound`). It's drawn in the browser, never prerendered
 * (vite.config.ts leaves /admin out), since it's different for everyone,
 * and the API decides who may see what whatever the page shows
 * (`permitted`, backend/auth/logged-in.ts).
 */
export const Route = createFileRoute("/admin")({
    ssr: false,
    head: () => ({
        meta: [{ title: "Admin" }, { name: "robots", content: "noindex" }]
    }),
    pendingComponent: DashboardLoading,
    notFoundComponent: AdminNotFound,
    component: Admin
})

function Admin() {
    const session = useSession()
    const { pathname } = useLocation()
    if (session.status === "loading") {
        return <DashboardLoading />
    } else if (session.status === "logged-out") {
        return <DashboardLogin heading="Log in to the admin" />
    }
    const { user, permissions } = session
    const section = adminSectionAt(pathname)
    // `data-private`: the admin shows people's names and the business's own
    // data, so a click here never sends the text it showed
    return (
        <div data-private>
            <DashboardFrame
                person={{
                    name: user.name,
                    email: user.email,
                    about: roleName(user.role)
                }}
                navigation={ADMIN_NAVIGATION}
                permissions={permissions}
                account="/admin/account"
                settings={settingsShownTo(permissions).length > 0}
            >
                {section === undefined ||
                allows(permissions, section.area, "read") ? (
                    <Outlet />
                ) : (
                    <NotPermitted name={section.name} />
                )}
            </DashboardFrame>
        </div>
    )
}
