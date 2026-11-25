import {
    matchQuery,
    mutationOptions,
    queryOptions,
    useQuery
} from "@tanstack/react-query"
import type { InferResponseType } from "hono/client"
import { client } from "@/backend/client"
import type { Permissions } from "@/utilities/permissions"
import type { LoginProof } from "@/utilities/schemas/auth"
import { FailedRequest, readFailure } from "./failures"

// Who's logged in, what they may do, and logging in and out
// (backend/auth/routes.ts): Infra emails a six-digit code and a link, and
// the API keeps the session in a cookie the page never sees.

/**
 * What the API answers when asked who's logged in: one of the team, with
 * what they may do in each area of the app, or null for each, and
 * whatever else the app says of whoever else logs in
 * (backend/auth/others.ts).
 */
export type SessionAnswer = InferResponseType<
    typeof client.api.auth.session.$get,
    200
>

/** Who's logged in, as the API answers them: one of the team. */
export type SessionUser = NonNullable<SessionAnswer["user"]>

/**
 * Who's logged in: GET /api/auth/session, as it answered, or null once
 * this browser has logged out. `useSession()` reads the team member from
 * it, and whatever else the app answers there is read from it too.
 */
export const sessionQuery = queryOptions({
    queryKey: ["session"],
    queryFn: async (): Promise<SessionAnswer | null> => {
        const response = await client.api.auth.session.$get()
        if (response.ok) {
            return await response.json()
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
 * Which of the team is logged in, for any component. A prerendered page is
 * drawn for a visitor, so it's "loading" until the browser asks: treat
 * that like a visitor, and hide only what would jump. Anyone who isn't one
 * of the team is "logged-out" here.
 */
export function useSession(): Session {
    const session = useQuery(sessionQuery)
    if (session.isPending) {
        return { status: "loading" }
    } else if (
        session.isError ||
        session.data === null ||
        session.data.user === null ||
        session.data.permissions === null
    ) {
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
    onSuccess: async (_verified, _input, _result, context) => {
        // A session fetched before this login, and answered after it,
        // would put the visitor back; and who's logged in is asked again,
        // rather than worked out here, since the app may say more of them
        // than this answer does
        await context.client.cancelQueries({ queryKey: sessionQuery.queryKey })
        await context.client.refetchQueries({ queryKey: sessionQuery.queryKey })
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
        // Who's logged in is set to no one, never removed: a screen watching
        // a query that's removed is never told, so the admin's frame would
        // go on drawing the user. Set, it draws the way in, and the screens
        // behind login go with it. A session fetched before this logout,
        // and answered after it, would put the user back
        const session = { queryKey: sessionQuery.queryKey, exact: true }
        await context.client.cancelQueries(session)
        context.client.setQueryData(sessionQuery.queryKey, null)
        // Then everything else goes, with anything still being fetched for
        // them, whose answer is dropped when it comes
        context.client.removeQueries({
            predicate: (query) => !matchQuery(session, query)
        })
    }
})
