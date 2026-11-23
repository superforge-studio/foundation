import { mutationOptions, queryOptions, useQuery } from "@tanstack/react-query"
import type { InferResponseType } from "hono/client"
import { client } from "@/backend/client"
import type { LoginProof } from "@/utilities/schemas/auth"
import { FailedRequest, readFailure } from "./failures"

// Who's logged in, and logging in and out (backend/auth/routes.ts): Infra
// emails a six-digit code and a link, and the API keeps the session in a
// cookie the page never sees.

/** Who's logged in, as the API answers them. */
export type SessionUser = NonNullable<
    InferResponseType<typeof client.api.auth.session.$get, 200>["user"]
>

/** Who's logged in, or null for a visitor: GET /api/auth/session. */
export const sessionQuery = queryOptions({
    queryKey: ["session"],
    queryFn: async (): Promise<SessionUser | null> => {
        const response = await client.api.auth.session.$get()
        if (response.ok) {
            const { user } = await response.json()
            return user
        } else {
            throw new FailedRequest(await readFailure(response))
        }
    }
})

export type Session =
    | { status: "loading" }
    | { status: "logged-out" }
    | { status: "logged-in"; user: SessionUser }

/**
 * Who's logged in, for any component. A prerendered page is drawn for a
 * visitor, so it's "loading" until the browser asks: treat that like a
 * visitor, and hide only what would jump.
 */
export function useSession(): Session {
    const session = useQuery(sessionQuery)
    if (session.isPending) {
        return { status: "loading" }
    } else if (session.isError || session.data === null) {
        return { status: "logged-out" }
    } else {
        return { status: "logged-in", user: session.data }
    }
}

/**
 * A login email that went out: the address as the API keeps it, which
 * the code goes with, whether the email holds a link, and, from a dev
 * server, which emails nothing, the code and the link it would hold.
 */
export type SentLogin = InferResponseType<
    typeof client.api.auth.start.$post,
    200
>

/** Emailing a login code and link. */
export const startLogin = mutationOptions({
    mutationKey: ["auth", "start"],
    mutationFn: async (input: { email: string }): Promise<SentLogin> => {
        const response = await client.api.auth.start.$post({ json: input })
        if (response.status === 200) {
            return await response.json()
        } else {
            throw new FailedRequest(await readFailure(response))
        }
    }
})

/** Logging in with the code from the email, or its link's token. */
export const verifyLogin = mutationOptions({
    mutationKey: ["auth", "verify"],
    mutationFn: async (input: LoginProof): Promise<SessionUser> => {
        const response = await client.api.auth.verify.$post({ json: input })
        if (response.status === 200) {
            const { user } = await response.json()
            return user
        } else {
            throw new FailedRequest(await readFailure(response))
        }
    },
    onSuccess: async (user, _input, _result, context) => {
        // A session fetched before this login, and answered after it,
        // would put the visitor back
        await context.client.cancelQueries({ queryKey: sessionQuery.queryKey })
        context.client.setQueryData(sessionQuery.queryKey, user)
    }
})

/** Logging out, which forgets everything this browser held for the user. */
export const logOut = mutationOptions({
    mutationKey: ["auth", "logout"],
    mutationFn: async () => {
        const response = await client.api.auth.logout.$post()
        if (response.ok) {
            return null
        } else {
            throw new FailedRequest(await readFailure(response))
        }
    },
    onSuccess: async (_data, _input, _result, context) => {
        await context.client.cancelQueries()
        context.client.removeQueries()
        context.client.setQueryData(sessionQuery.queryKey, null)
    }
})
