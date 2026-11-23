import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { useNow } from "@/frontend/components/dashboard/marks"
import {
    AddPersonPane,
    PeopleList,
    PersonDetailPane
} from "@/frontend/components/dashboard/people"
import {
    CouldNotLoad,
    ListLoading,
    Panes
} from "@/frontend/components/dashboard/shell"
import { useSession } from "@/frontend/queries/auth"
import { usersQuery } from "@/frontend/queries/users"

/**
 * Everyone who can log in: the list on the left, and the chosen person on
 * the right, by their id in the address (`?person=`), or the form that adds
 * someone (`?person=new`).
 */
export const Route = createFileRoute("/dashboard/people")({
    validateSearch: z.object({
        person: z.string().optional().catch(undefined)
    }),
    head: () => ({ meta: [{ title: "People · Dashboard" }] }),
    component: People
})

function People() {
    const { person } = Route.useSearch()
    const now = useNow()
    const session = useSession()
    const users = useQuery(usersQuery)
    const list = users.data ?? []
    const chosen =
        person === "new"
            ? undefined
            : (list.find((each) => each.id === person) ?? list[0])
    const you = session.status === "logged-in" ? session.user.id : null

    return (
        <Panes
            chosen={person !== undefined}
            list={
                users.isPending ? (
                    <ListLoading />
                ) : users.isError && users.data === undefined ? (
                    <CouldNotLoad
                        what="The people"
                        onRetry={() => users.refetch()}
                    />
                ) : (
                    <PeopleList people={list} chosen={chosen?.id} now={now} />
                )
            }
            detail={
                person === "new" ? (
                    <AddPersonPane />
                ) : chosen === undefined ? null : (
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
