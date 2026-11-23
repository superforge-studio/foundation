import { mutationOptions, queryOptions } from "@tanstack/react-query"
import type { InferResponseType } from "hono/client"
import { client } from "@/backend/client"
import { sessionQuery } from "./auth"
import { FailedRequest, readFailure } from "./failures"

// The logged-in person's own account (backend/account/routes.ts): what
// they're called, and the browsers they're logged in on

/** A browser someone is logged in on, as the API answers it. */
export type AccountSession = InferResponseType<
    typeof client.api.account.sessions.$get,
    200
>["sessions"][number]

/** Where the logged-in person is logged in: GET /api/account/sessions. */
export const accountSessionsQuery = queryOptions({
    queryKey: ["account", "sessions"],
    queryFn: async () => {
        const response = await client.api.account.sessions.$get()
        if (response.status === 200) {
            return (await response.json()).sessions
        } else {
            throw new FailedRequest(await readFailure(response))
        }
    }
})

/** Setting or clearing their name, which every page's session then shows. */
export const renameAccount = mutationOptions({
    mutationKey: ["account", "rename"],
    mutationFn: async (input: { name: string | null }) => {
        const response = await client.api.account.$patch({ json: input })
        if (response.status === 200) {
            return await response.json()
        } else {
            throw new FailedRequest(await readFailure(response))
        }
    },
    onSuccess: async (_data, _input, _result, context) => {
        await context.client.invalidateQueries({
            queryKey: sessionQuery.queryKey
        })
    }
})

/** Logging one of their other browsers out. */
export const endAccountSession = mutationOptions({
    mutationKey: ["account", "end-session"],
    mutationFn: async (input: { id: string }) => {
        const response = await client.api.account.sessions[":id"].$delete({
            param: input
        })
        if (response.status === 200) {
            return null
        } else {
            throw new FailedRequest(await readFailure(response))
        }
    },
    onSuccess: async (_data, _input, _result, context) => {
        await context.client.invalidateQueries({
            queryKey: accountSessionsQuery.queryKey
        })
    }
})

/** Logging every other browser out, keeping this one. */
export const logOutOthers = mutationOptions({
    mutationKey: ["account", "logout-others"],
    mutationFn: async () => {
        const response =
            await client.api.account.sessions["logout-others"].$post()
        if (response.status === 200) {
            return (await response.json()).ended
        } else {
            throw new FailedRequest(await readFailure(response))
        }
    },
    onSuccess: async (_data, _input, _result, context) => {
        await context.client.invalidateQueries({
            queryKey: accountSessionsQuery.queryKey
        })
    }
})
