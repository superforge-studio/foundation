import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { useNow } from "@/frontend/components/dashboard/marks"
import {
    CouldNotLoad,
    ListLoading,
    NotPermitted,
    Panes
} from "@/frontend/components/dashboard/shell"
import {
    PersonDetailPane,
    TeamList
} from "@/frontend/components/dashboard/team"
import { useSession } from "@/frontend/queries/auth"
import { usersQuery } from "@/frontend/queries/users"
import { allows } from "@/utilities/permissions"

/**
 * The team, as the app's code lists it: the list on the left, and the
 * chosen person on the right, by their id in the address (`?person=`).
 * Only for a role that may read the team.
 */
export const Route = createFileRoute("/admin/team")({
    validateSearch: z.object({
        person: z.string().optional().catch(undefined)
    }),
    head: () => ({ meta: [{ title: "Team · Admin" }] }),
    component: Team
})

function Team() {
    const session = useSession()
    if (
        session.status === "logged-in" &&
        !allows(session.permissions, "team", "read")
    ) {
        return <NotPermitted name="the team" />
    } else {
        return <People />
    }
}

function People() {
    const { person } = Route.useSearch()
    const now = useNow()
    const session = useSession()
    const users = useQuery(usersQuery)
    const list = users.data ?? []
    const chosen =
        list.find((each) => each.id === person) ??
        list.find((each) => each.listed)
    const you = session.status === "logged-in" ? session.user.id : null

    return (
        <Panes
            chosen={person !== undefined}
            list={
                users.isPending ? (
                    <ListLoading />
                ) : users.isError && users.data === undefined ? (
                    <CouldNotLoad
                        what="The team"
                        onRetry={() => users.refetch()}
                    />
                ) : (
                    <TeamList people={list} chosen={chosen?.id} now={now} />
                )
            }
            detail={
                chosen === undefined ? null : (
                    <PersonDetailPane
                        key={chosen.id}
                        person={chosen}
                        you={chosen.id === you}
                    />
                )
            }
        />
    )
}
