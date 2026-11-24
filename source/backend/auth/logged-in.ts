import type { Context } from "hono"
import { deleteCookie, getCookie, setCookie } from "hono/cookie"
import { createFactory } from "hono/factory"
import type { Database } from "@/database"
import {
    type Area,
    allows,
    every,
    type Level,
    narrowed,
    type Permissions
} from "@/utilities/permissions"
import { AGENT_SCOPES, type AgentScope } from "@/utilities/schemas/agents"
import type { ApiEnvironment } from "../context"
import { failure } from "../failures"
import { type Access, listedBySlug, listing, permissionsOf } from "./access"
import { agentUser, bearerToken } from "./agents"
import { apiTokenUser, isApiToken } from "./api-tokens"
import {
    liveSession,
    renewSession,
    SESSION_LIFETIME,
    type TeamMember
} from "./sessions"

// Who's logged in, and what they may do: the `session` cookie, or a token in
// its place, either the one Claude brings (agents.ts) or an API token
// someone made for a script (api-tokens.ts), and the middleware that reads
// them. This is the one place that decides who's logged in, so a route
// that needs them takes `permitted` (or `loggedIn`, or `maybeLoggedIn`) and
// reads `context.var.user`; nothing else reads the cookie or the tokens.
// Only the team logs in, and someone counts only while access.ts lists
// them, by their slug, whatever the database says; their role, and so what
// they may do, is the one the list gives them.

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
 * the team (agents.ts); or a script, by an API token one of them made
 * (`Authorization: Bearer api_…`, api-tokens.ts)
 */
export type LoggedInWith = "session" | "agent" | "token"

type LoggedIn = {
    Variables: ApiEnvironment["Variables"] & {
        user: TeamMember
        session: RequestSession
        logged_in_with: LoggedInWith
        /** What the request was let do: everything for a browser */
        scopes: readonly AgentScope[]
        /**
         * What the request may do in each area: the person's role's, and
         * for a token, no more than the token was given
         */
        permissions: Permissions
    }
}

/**
 * For what's anyone on the team's own, like their account: lets a request
 * through only when one of the team is logged in, and puts them on
 * `context.var.user`, the session's id on `context.var.session`, how they
 * logged in on `context.var.logged_in_with`, and what they may do on
 * `context.var.permissions`; without one, it's answered 401 `logged-out`.
 * A browser's session is renewed, keeping the same token, so coming back
 * keeps someone logged in, and one that has ended stays ended. Claude, or
 * a script, with a token, gets through as the person who allowed it or
 * made it, while they're on the team, and with only `read`, makes `GET`
 * requests alone (403 `read-only`). What's the business's, rather than
 * someone's own, takes `permitted` instead.
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
 * `loggedIn` for what's the business's, in one of the app's areas
 * (utilities/permissions/): lets a request through only when whoever's
 * asking may do this in `area`. A route that reads, a `GET` or a `HEAD`,
 * needs `read`, and any other needs `write`, unless `level` says, as for a
 * `POST` that only reads. Someone whose role doesn't reach it is answered
 * 403 `not-permitted`, saying which area and level it needed, and a token
 * that wasn't given it, 403 `read-only`. What the request may do is on
 * `context.var.permissions`. Every route of the business's names its area
 * this way, which a test checks (tests/routes.test.ts), so who may do what
 * is said at each route, and nowhere else.
 */
export function permitted(area: Area, level?: Exclude<Level, "none">) {
    const middleware = createFactory<LoggedIn>().createMiddleware(
        async (context, next) => {
            const asking = await whoIsAsking(context)
            const needed = level ?? levelFor(context.req.method)
            if (asking === undefined) {
                return failure(context, 401, "logged-out", "Log in first")
            } else if (
                !allows(
                    permissionsOf(context.var.access, asking.user.role),
                    area,
                    needed
                )
            ) {
                return failure(
                    context,
                    403,
                    "not-permitted",
                    `As ${article(asking.user.role)} ${asking.user.role}, you can't ${needed === "read" ? "see" : "change"} ${area} here`,
                    { area, level: needed }
                )
            } else if (!allows(permissionsFor(context, asking), area, needed)) {
                return readOnly(context, asking)
            } else {
                return await letThrough(context, asking, next)
            }
        }
    )
    REQUIREMENTS.set(middleware, { area, level })
    return middleware
}

/**
 * What a route's handler needs, if it's a `permitted` middleware: its area,
 * and its level, or undefined when it's the method's. For whatever lists
 * the routes: the test that every route says who may call it, and the
 * MCP's list_routes.
 */
export function requirementOf(handler: unknown) {
    return typeof handler === "function" ? REQUIREMENTS.get(handler) : undefined
}

// What each `permitted` middleware needs, by the middleware
const REQUIREMENTS = new WeakMap<
    object,
    { area: Area; level: Exclude<Level, "none"> | undefined }
>()

/**
 * After `loggedIn` or `permitted`, for what only a person in a browser
 * may do, never Claude or a script with a token: where someone's logged
 * in, Claude's own connections and allowing Claude in, and API tokens. So
 * a token that leaks can't make itself more, or lock anyone out. Answers
 * 403 `browser-only`.
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
 * logged in: `context.var.user` and `context.var.permissions` are null for
 * a visitor, rather than the request being refused, so a visitor's browser
 * logs no failed request. A user's session is renewed the same way. A token
 * is held to its scopes as `loggedIn` holds it: one with only `read`, sent
 * with anything but a `GET` or a `HEAD`, is nobody's, so the route answers
 * it as a visitor, as recording a visit does, and never acts as its person.
 */
export const maybeLoggedIn = createFactory<{
    Variables: ApiEnvironment["Variables"] & {
        user: TeamMember | null
        permissions: Permissions | null
    }
}>().createMiddleware(async (context, next) => {
    const asking = await whoIsAsking(context)
    if (asking === undefined || !mayDo(context, asking)) {
        context.set("user", null)
        context.set("permissions", null)
        await next()
    } else if (asking.by !== "session") {
        context.set("user", asking.user)
        context.set("permissions", permissionsFor(context, asking))
        await next()
    } else {
        context.set("user", asking.user)
        context.set("permissions", permissionsFor(context, asking))
        await renewed(
            context,
            context.var.database,
            asking.token,
            asking.renewable,
            next
        )
    }
})

// Who's asking: a browser's session, by its cookie, or a token's holder: an
// API token's, by its `api_` prefix (api-tokens.ts), or else Claude's
// (agents.ts), each one of the team, with the names and the role access.ts
// lists them with. A request with a token is the token's whatever cookie it
// carries, and one with a bad token is nobody's.
type Asking =
    | {
          by: "session"
          user: TeamMember
          id: string
          token: string
          renewable: boolean
      }
    | { by: "agent"; user: TeamMember; scopes: AgentScope[] }
    | { by: "token"; user: TeamMember; scopes: AgentScope[] }

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

// What a request may do in each area: its person's role's, and for a
// token, no more than it was given: `read` reads every area, and `act`
// changes them too
function permissionsFor<Environment extends ApiEnvironment>(
    context: Context<Environment>,
    asking: Asking
): Permissions {
    const variables: ApiEnvironment["Variables"] = context.var
    const role = permissionsOf(variables.access, asking.user.role)
    if (asking.by === "session") {
        return role
    } else {
        return narrowed(
            role,
            every(asking.scopes.includes("act") ? "write" : "read")
        )
    }
}

/** What a request in `method` needs by default: a read reads, and anything else writes. */
export function levelFor(method: string): Exclude<Level, "none"> {
    return ["GET", "HEAD"].includes(method) ? "read" : "write"
}

// "a" or "an", for a role's name
function article(word: string) {
    return /^[aeiou]/i.test(word) ? "an" : "a"
}

// Whether what's asking may make this request, on a route that's anyone's
// own: anyone may read, and only a browser, or a token with `act`, may
// change anything
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
    context.set("permissions", permissionsFor(context, asking))
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

// The live session behind this token, if it still counts: its person's
// while access.ts lists them by their slug, with the names and the role it
// lists them with. One that doesn't count answers as no session, so
// they're logged out.
async function currentSession(
    database: Database,
    access: Access,
    token: string
) {
    const session = await liveSession(database, token)
    const listed =
        session === undefined
            ? undefined
            : listedBySlug(access, session.user.slug)
    if (session === undefined || listed === undefined) {
        return undefined
    } else {
        const user: TeamMember = { ...session.user, ...listing(listed) }
        return { ...session, user }
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
