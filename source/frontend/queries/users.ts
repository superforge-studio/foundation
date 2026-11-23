import { queryOptions } from "@tanstack/react-query"
import type { InferResponseType } from "hono/client"
import { client } from "@/backend/client"
import { FailedRequest, readFailure } from "./failures"

// The team (backend/users/routes.ts), for the dashboard's Team screen,
// which whoever may read the team sees

/** Someone on the team, or once on it, as the API answers them. */
export type Person = InferResponseType<
    typeof client.api.users.$get,
    200
>["users"][number]

/** The team, and those taken off it, newest first: GET /api/users. */
export const usersQuery = queryOptions({
    queryKey: ["users"],
    queryFn: async () => {
        const response = await client.api.users.$get()
        if (response.status === 200) {
            return (await response.json()).users
        } else {
            throw new FailedRequest(await readFailure(response))
        }
    }
})
