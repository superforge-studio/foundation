import { mutationOptions, queryOptions } from "@tanstack/react-query"
import type { InferResponseType } from "hono/client"
import { client } from "@/backend/client"
import type { AgentScope } from "@/utilities/schemas/agents"
import type { ApiTokenLifetime } from "@/utilities/schemas/api-tokens"
import { FailedRequest, readFailure } from "./failures"

// The logged-in person's own account (backend/account/routes.ts): what
// they're called, the browsers they're logged in on, and for one of the
// business's own, their API tokens

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

/** One of someone's API tokens, as the API answers it: never the token. */
export type AccountApiToken = InferResponseType<
    typeof client.api.account.tokens.$get,
    200
>["tokens"][number]

/** Their API tokens, newest first: GET /api/account/tokens. */
export const accountTokensQuery = queryOptions({
    queryKey: ["account", "tokens"],
    queryFn: async () => {
        const response = await client.api.account.tokens.$get()
        if (response.status === 200) {
            return (await response.json()).tokens
        } else {
            throw new FailedRequest(await readFailure(response))
        }
    }
})

/** Making one: answers the token itself, which nothing shows again. */
export const makeApiToken = mutationOptions({
    mutationKey: ["account", "make-token"],
    mutationFn: async (input: {
        name: string
        scopes: AgentScope[]
        expires_in_days: ApiTokenLifetime | null
    }) => {
        const response = await client.api.account.tokens.$post({ json: input })
        if (response.status === 200) {
            return await response.json()
        } else {
            throw new FailedRequest(await readFailure(response))
        }
    },
    onSuccess: async (_data, _input, _result, context) => {
        await context.client.invalidateQueries({
            queryKey: accountTokensQuery.queryKey
        })
    }
})

/** Revoking one, so the next request with it is refused. */
export const revokeApiToken = mutationOptions({
    mutationKey: ["account", "revoke-token"],
    mutationFn: async (input: { id: string }) => {
        const response = await client.api.account.tokens[":id"].$delete({
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
            queryKey: accountTokensQuery.queryKey
        })
    }
})
