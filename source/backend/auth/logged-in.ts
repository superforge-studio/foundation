import type { Context } from "hono"
import { deleteCookie, getCookie, setCookie } from "hono/cookie"
import { createFactory } from "hono/factory"
import type { Database } from "@/database"
import { AGENT_SCOPES, type AgentScope } from "@/utilities/schemas/agents"
import { isInternal } from "@/utilities/schemas/users"
import type { ApiEnvironment } from "../context"
import { failure } from "../failures"
import { type Access, roleFor } from "./access"
import { agentUser, bearerToken } from "./agents"
import { apiTokenUser, isApiToken } from "./api-tokens"
import {
    liveSession,
    renewSession,
    SESSION_LIFETIME,
    type SessionUser
} from "./sessions"

// Who's logged in: the `session` cookie, or a token in its place, either the
// one Claude brings (agents.ts) or an API token someone made for a script
// (api-tokens.ts), and the middleware that reads them. This is the one
// place that decides who's logged in, so a route that needs the user takes
// `loggedIn` (or `maybeLoggedIn`, or `internalOnly`) and reads
// `context.var.user`; nothing else reads the cookie or the tokens. Their
// role is the one access.ts gives them, whatever the database says, so
// only the people listed there are ever internal.

const COOKIE = "session"

/** This browser's session token, from its cookie, if it has one. */
export function sessionToken(context: Context) {
    return getCookie(context, COOKIE)
}

/**
 * Sets the session's cookie for its whole lifetime, as it starts and each
 * time it's renewed: the browser drops it when this runs out, whatever the
 * session has left.
 */
export function setSessionCookie(context: Context, token: string) {
    setCookie(context, COOKIE, token, {
        httpOnly: true,
        secure: secureCookie(context.req.url),
        // Sent when someone follows a link here, but not with a request
        // another site's page makes, so another site can't act as them
        sameSite: "Lax",
        path: "/",
        maxAge: SESSION_LIFETIME / 1000
    })
}

/** Clears the session's cookie, as logging out does. */
export function clearSessionCookie(context: Context) {
    deleteCookie(context, COOKIE, {
        path: "/",
        secure: secureCookie(context.req.url)
    })
}

/**
 * Whether a cookie set in answer to `request_url` is `Secure`: everywhere
 * but plain http on this computer, or a dev server reached over plain http
 * from another, where a browser won't keep a Secure cookie: the build run
 * with `pnpm preview`, or `pnpm dev`. Behind Railway's proxy a request's
 * own address says http, though the browser's said https, so the protocol
 * alone can't say. The visitor's cookies follow it too (visits/cookies.ts).
 */
export function secureCookie(request_url: string) {
    const { protocol, hostname } = new URL(request_url)
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(hostname)
    return !(protocol === "http:" && (local || import.meta.env.DEV))
}

/**
 * The session a request came with, as a route behind `loggedIn` sees it.
 * A token's requests have none, and get `AGENT_SESSION` or
 * `API_TOKEN_SESSION`, which no session's id ever is.
 */
export type RequestSession = { id: string }

/** The session Claude's requests get, which is never a real one's id */
export const AGENT_SESSION: RequestSession = { id: "agent" }

/** The session an API token's requests get, which is never a real one's id */
export const API_TOKEN_SESSION: RequestSession = { id: "api-token" }

/**
 * How a request logged in: a browser, by its `session` cookie; Claude, by
 * an access token Infra signed (`Authorization: Bearer`), acting as one of
 * the business's own people (agents.ts); or a script, by an API token one
 * of them made (`Authorization: Bearer api_…`, api-tokens.ts)
 */
export type LoggedInWith = "session" | "agent" | "token"

type LoggedIn = {
    Variables: ApiEnvironment["Variables"] & {
        user: SessionUser
        session: RequestSession
        logged_in_with: LoggedInWith
        /** What the request may do: everything for a browser */
        scopes: readonly AgentScope[]
    }
}

/**
 * Lets a request through only when someone is logged in, and puts their
 * user on `context.var.user`, the session's id on `context.var.session`,
 * and how they logged in on `context.var.logged_in_with`; without one,
 * it's answered 401 `logged-out`. A browser's session is renewed, keeping
 * the same token, so coming back keeps someone logged in, and one that has
 * ended stays ended. Claude, or a script, with a token, gets through as the
 * person who allowed it or made it, while they're one of the business's
 * own, and with only `read`, makes `GET` requests alone (403 `read-only`).
 */
export const loggedIn = createFactory<LoggedIn>().createMiddleware(
    // From a factory rather than plain `createMiddleware`, so the 401 below
    // is inferred into each route's type and the typed client knows it
    async (context, next) => {
        const asking = await whoIsAsking(context)
        if (asking === undefined) {
            return failure(context, 401, "logged-out", "Log in first")
        } else if (!mayDo(context, asking)) {
            return readOnly(context, asking)
        } else {
            return await letThrough(context, asking, next)
        }
    }
)

/**
 * `loggedIn` for the business's side of the dashboard: only someone whose
 * role is one of its own (`isInternal`, utilities/schemas/users.ts) gets
 * through, and anyone else logged in is answered 403 `not-internal`.
 */
export const internalOnly = createFactory<LoggedIn>().createMiddleware(
    async (context, next) => {
        const asking = await whoIsAsking(context)
        if (asking === undefined) {
            return failure(context, 401, "logged-out", "Log in first")
        } else if (!isInternal(asking.user.role)) {
            return failure(
                context,
                403,
                "not-internal",
                "Only the business's own people can see this"
            )
        } else if (!mayDo(context, asking)) {
            return readOnly(context, asking)
        } else {
            return await letThrough(context, asking, next)
        }
    }
)

/**
 * After `loggedIn` or `internalOnly`, for what only a person in a browser
 * may do, never Claude or a script with a token: who can log in and where
 * someone's logged in, Claude's own connections and allowing Claude in, and
 * API tokens. So a token that leaks can't make itself more, or lock anyone
 * out. Answers 403 `browser-only`.
 */
export const inBrowser = createFactory<LoggedIn>().createMiddleware(
    async (context, next) => {
        if (context.var.logged_in_with !== "session") {
            return failure(
                context,
                403,
                "browser-only",
                "Only a person logged in on the dashboard can do this"
            )
        } else {
            await next()
        }
    }
)

/**
 * `loggedIn` for a route anyone may call, like the one every page asks who's
 * logged in: `context.var.user` is null for a visitor, rather than the
 * request being refused, so a visitor's browser logs no failed request. A
 * user's session is renewed the same way.
 */
export const maybeLoggedIn = createFactory<{
    Variables: ApiEnvironment["Variables"] & { user: SessionUser | null }
}>().createMiddleware(async (context, next) => {
    const asking = await whoIsAsking(context)
    if (asking === undefined) {
        context.set("user", null)
        await next()
    } else if (asking.by !== "session") {
        context.set("user", asking.user)
        await next()
    } else {
        context.set("user", asking.user)
        await renewed(
            context,
            context.var.database,
            asking.token,
            asking.renewable,
            next
        )
    }
})

// Who's asking: a browser's session, by its cookie, with its user's role
// as access.ts gives it, or a token's holder: an API token's, by its
// `api_` prefix (api-tokens.ts), or else Claude's (agents.ts). A request
// with a token is the token's whatever cookie it carries, and one with a
// bad token is nobody's.
type Asking =
    | {
          by: "session"
          user: SessionUser
          id: string
          token: string
          renewable: boolean
      }
    | { by: "agent"; user: SessionUser; scopes: AgentScope[] }
    | { by: "token"; user: SessionUser; scopes: AgentScope[] }

async function whoIsAsking<Environment extends ApiEnvironment>(
    context: Context<Environment>
): Promise<Asking | undefined> {
    const variables: ApiEnvironment["Variables"] = context.var
    const bearer = bearerToken(context.req.header("Authorization"))
    if (bearer !== null && isApiToken(bearer)) {
        const holder = await apiTokenUser(
            variables.database,
            variables.access,
            bearer
        )
        return holder === undefined ? undefined : { by: "token", ...holder }
    } else if (bearer !== null) {
        const agent = await agentUser(variables, bearer, context.req.url)
        return agent === undefined ? undefined : { by: "agent", ...agent }
    }
    const token = sessionToken(context)
    const session =
        token === undefined
            ? undefined
            : await currentSession(variables.database, variables.access, token)
    if (token === undefined || session === undefined) {
        return undefined
    } else {
        return {
            by: "session",
            user: session.user,
            id: session.id,
            token,
            renewable: session.renewable
        }
    }
}

// Whether what's asking may make this request: anyone may read, and only
// a browser, or a token with `act`, may change anything
function mayDo(context: Context, asking: Asking) {
    const reads = ["GET", "HEAD"].includes(context.req.method)
    return reads || asking.by === "session" || asking.scopes.includes("act")
}

function readOnly(context: Context, asking: Asking) {
    return failure(
        context,
        403,
        "read-only",
        asking.by === "token"
            ? "This API token may read here, not change anything"
            : "Claude was allowed to read here, not to change anything"
    )
}

// Puts who's asking on `context` and runs the route, renewing a browser's
// session as it goes
async function letThrough(
    context: Context<LoggedIn>,
    asking: Asking,
    next: () => Promise<void>
) {
    context.set("user", asking.user)
    if (asking.by === "agent") {
        context.set("session", AGENT_SESSION)
        context.set("logged_in_with", "agent")
        context.set("scopes", asking.scopes)
        await next()
    } else if (asking.by === "token") {
        context.set("session", API_TOKEN_SESSION)
        context.set("logged_in_with", "token")
        context.set("scopes", asking.scopes)
        await next()
    } else {
        context.set("session", { id: asking.id })
        context.set("logged_in_with", "session")
        context.set("scopes", AGENT_SCOPES)
        await renewed(
            context,
            context.var.database,
            asking.token,
            asking.renewable,
            next
        )
    }
}

// The live session behind this token, with its user's role as access.ts
// gives it
async function currentSession(
    database: Database,
    access: Access,
    token: string
) {
    const session = await liveSession(database, token)
    if (session === undefined) {
        return undefined
    } else {
        const { user } = session
        return {
            ...session,
            user: { ...user, role: roleFor(access, user.email, user.role) }
        }
    }
}

// Runs the route, renewing the session first when it's due, and sets the
// renewed cookie after the route, since a header set before it is lost on
// a plain `Response`
async function renewed(
    context: Context,
    database: Database,
    token: string,
    renewable: boolean,
    next: () => Promise<void>
) {
    const renewing = renewable && (await renewSession(database, token))
    await next()
    if (renewing) {
        setSessionCookie(context, token)
    }
}
