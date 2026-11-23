import { mutationOptions, queryOptions } from "@tanstack/react-query"
import type { InferResponseType } from "hono/client"
import type { z } from "zod"
import { client } from "@/backend/client"
import type { ExternalRole, user_addition } from "@/utilities/schemas/users"
import { FailedRequest, readFailure } from "./failures"

// Everyone who can log in (backend/users/routes.ts), for the dashboard's
// People screen, which only the business's own people see

/** Someone who can log in, as the API answers them. */
export type Person = InferResponseType<
    typeof client.api.users.$get,
    200
>["users"][number]

/** Everyone who can log in, newest first: GET /api/users. */
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

/** Adding someone before they log in. Answers their id. */
export const addUser = mutationOptions({
    mutationKey: ["users", "add"],
    mutationFn: async (input: z.input<typeof user_addition>) => {
        const response = await client.api.users.$post({ json: input })
        if (response.status === 201) {
            return (await response.json()).id
        } else {
            throw new FailedRequest(await readFailure(response))
        }
    },
    onSuccess: async (_data, _input, _result, context) => {
        await context.client.invalidateQueries({
            queryKey: usersQuery.queryKey
        })
    }
})

/** Giving someone another role. */
export const changeRole = mutationOptions({
    mutationKey: ["users", "change-role"],
    mutationFn: async (input: { id: string; role: ExternalRole }) => {
        const response = await client.api.users[":id"].$patch({
            param: { id: input.id },
            json: { role: input.role }
        })
        if (response.status === 200) {
            return null
        } else {
            throw new FailedRequest(await readFailure(response))
        }
    },
    onSuccess: async (_data, _input, _result, context) => {
        await context.client.invalidateQueries({
            queryKey: usersQuery.queryKey
        })
    }
})

/** Removing someone, which logs them out everywhere. */
export const removeUser = mutationOptions({
    mutationKey: ["users", "remove"],
    mutationFn: async (input: { id: string }) => {
        const response = await client.api.users[":id"].$delete({
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
            queryKey: usersQuery.queryKey
        })
    }
})
