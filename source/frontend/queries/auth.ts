import { mutationOptions, queryOptions, useQuery } from "@tanstack/react-query"
import type { InferResponseType } from "hono/client"
import { client } from "@/backend/client"
import type { Permissions } from "@/utilities/permissions"
import type { LoginProof } from "@/utilities/schemas/auth"
import { FailedRequest, readFailure } from "./failures"

// Who's logged in, what they may do, and logging in and out
// (backend/auth/routes.ts): Infra emails a six-digit code and a link, and
// the API keeps the session in a cookie the page never sees.

/** Who's logged in, as the API answers them: one of the team. */
export type SessionUser = NonNullable<
    InferResponseType<typeof client.api.auth.session.$get, 200>["user"]
>

/** Who's logged in, and what they may do in each area of the app. */
type LoggedIn = { user: SessionUser; permissions: Permissions }

/** Who's logged in, or null for a visitor: GET /api/auth/session. */
export const sessionQuery = queryOptions({
    queryKey: ["session"],
    queryFn: async (): Promise<LoggedIn | null> => {
        const response = await client.api.auth.session.$get()
        if (response.ok) {
            const { user, permissions } = await response.json()
            return user === null || permissions === null
                ? null
                : { user, permissions }
        } else {
            throw new FailedRequest(await readFailure(response))
        }
    }
})

export type Session =
    | { status: "loading" }
    | { status: "logged-out" }
    | { status: "logged-in"; user: SessionUser; permissions: Permissions }

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
        return {
            status: "logged-in",
            user: session.data.user,
            permissions: session.data.permissions
        }
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

/**
 * Whoever a login logged in, as the API answers them: one of the team, or
 * whoever else the app lets in (backend/auth/others.ts).
 */
export type Verified = InferResponseType<
    typeof client.api.auth.verify.$post,
    200
>

/** Logging in with the code from the email, or its link's token. */
export const verifyLogin = mutationOptions({
    mutationKey: ["auth", "verify"],
    mutationFn: async (input: LoginProof): Promise<Verified> => {
        const response = await client.api.auth.verify.$post({ json: input })
        if (response.status === 200) {
            return await response.json()
        } else {
            throw new FailedRequest(await readFailure(response))
        }
    },
    onSuccess: async (verified, _input, _result, context) => {
        // A session fetched before this login, and answered after it,
        // would put the visitor back
        await context.client.cancelQueries({ queryKey: sessionQuery.queryKey })
        if ("user" in verified) {
            const logged_in: LoggedIn = {
                user: verified.user,
                permissions: verified.permissions
            }
            context.client.setQueryData(sessionQuery.queryKey, logged_in)
        } else {
            // Someone else the app lets in: no one on the team is logged
            // in, and whatever asks about them asks again
            context.client.setQueryData(sessionQuery.queryKey, null)
            await context.client.invalidateQueries()
        }
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
