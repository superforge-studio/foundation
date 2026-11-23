import { type Context, Hono } from "hono"
import { login_start, login_verify } from "@/utilities/schemas/auth"
import type { ApiEnvironment } from "../context"
import { failure, validated } from "../failures"
import { listedInternal, permissionsOf } from "./access"
import { OTHERS } from "./app"
import {
    clearSessionCookie,
    maybeLoggedIn,
    sessionToken,
    setSessionCookie
} from "./logged-in"
import { logIn, mayLogIn } from "./login"
import { NOT_LISTED } from "./others"
import { endSession } from "./sessions"
import { appOrigin, visitorBrowser, visitorIp } from "./visitor"

// What the page says when Infra can't be asked: the reason the route
// answers. Why, in Infra's words or its package's, goes to the logs, and
// to the business's own people (`forTheTeam`)
const UNAVAILABLE = "Login isn't working right now. Try again soon."

/**
 * Logging in, under /api/auth, with no password: Infra emails a six-digit
 * code and a link, and says whose email the code or the link is when the
 * visitor brings one back (backend/infra/). Only the team logs in, as
 * access.ts lists them, and the app keeps their user and their session,
 * unless the app gives someone else a way in (./others.ts), who's asked
 * only of an address the team doesn't have. Starting and verifying take JSON, which a form on another site
 * can't send; logging out takes no body, and the API refuses another
 * site's form (`csrf()` in index.ts). The cookie is SameSite=Lax, so
 * another site's page can't act as anyone (logged-in.ts).
 */
export const authRoutes = new Hono<ApiEnvironment>()
    // Who's logged in, and what they may do in each area, or null for a
    // visitor: what every page asks, so the dashboard leaves out what
    // someone can't use; and whatever else the app says of whoever else
    // logs in (./others.ts)
    .get("/auth/session", maybeLoggedIn, async (context) =>
        context.json(
            {
                user: context.var.user,
                permissions: context.var.permissions,
                ...(await OTHERS.session(context))
            },
            200
        )
    )

    // Emails the code, and a link to this app's /login when this is one of
    // the project's domains. In a dev server, which emails nothing, the
    // answer holds the code and the link for the page to show. Anyone not
    // on the team, whom nothing else lets in either, is refused before
    // Infra is asked, so nothing is emailed to them.
    .post("/auth/start", validated("json", login_start), async (context) => {
        const { email } = context.req.valid("json")
        if (
            !mayLogIn(context.var.access, email) &&
            !(await OTHERS.mayLogIn(context, email))
        ) {
            return failure(context, 403, "not-listed", NOT_LISTED)
        }
        const started = await context.var.infra.startLogin({
            channel: "email",
            address: email,
            ip: visitorIp(context),
            link_to: `${appOrigin(context)}/login`
        })
        if (started.ok) {
            const { test, address, with_link, expires_at } = started.data
            return context.json(
                {
                    email: address,
                    with_link,
                    expires_at,
                    // Never in a build, which takes only a secret key, so
                    // Infra sends the email and answers no test
                    development: import.meta.env.DEV ? test : null
                },
                200
            )
        }

        const refused = started.error
        if (refused.reason === "rate-limited") {
            context.header("Retry-After", String(refused.retry_after))
            return failure(
                context,
                429,
                refused.reason,
                "Too many login emails for now",
                { retry_after: refused.retry_after, limit: refused.limit }
            )
        } else if (refused.reason === "not-sent") {
            return failure(
                context,
                502,
                refused.reason,
                "The email didn't go out. Asking again can work at once.",
                forTheTeam(context, email, refused.message)
            )
        } else {
            return failure(
                context,
                503,
                refused.reason,
                UNAVAILABLE,
                forTheTeam(context, email, refused.message)
            )
        }
    })

    // Logs in with the code the visitor typed, or the link's token, which
    // the login page posts from the link's fragment (`/login#<token>`)
    // once the visitor presses to finish, so it stays out of addresses and
    // logs, and a mail scanner that opens the link spends nothing
    .post("/auth/verify", validated("json", login_verify), async (context) => {
        const proof = context.req.valid("json")
        const verified = await context.var.infra.verifyLogin(
            "token" in proof
                ? proof
                : { channel: "email", address: proof.email, code: proof.code }
        )
        if (verified.ok) {
            const logged_in = await logIn(context.var.database, {
                email: verified.data.address,
                replacing: sessionToken(context),
                user_agent: visitorBrowser(context),
                access: context.var.access
            })
            if (!logged_in.ok) {
                // Not one of the team: whoever else logs in, if anyone
                // does, or refused (./others.ts)
                return await OTHERS.logIn(context, verified.data.address)
            }
            // The session this browser had, if it was someone else's
            const replaced = sessionToken(context)
            if (replaced !== undefined) {
                await OTHERS.logOut(context, replaced)
            }
            const { user, token } = logged_in.data
            setSessionCookie(context, token)
            console.info("Logged in", { user_id: user.id })
            return context.json(
                {
                    user,
                    permissions: permissionsOf(context.var.access, user.role)
                },
                200
            )
        }

        const refused = verified.error
        if (refused.reason === "wrong-code") {
            return failure(
                context,
                400,
                refused.reason,
                "That isn't the code",
                { attempts_left: refused.attempts_left }
            )
        } else if (refused.reason === "no-code") {
            return failure(
                context,
                400,
                refused.reason,
                "There's no code to try: send a new one"
            )
        } else if (refused.reason === "no-link") {
            return failure(
                context,
                400,
                refused.reason,
                "The link has expired or was used: send a new one"
            )
        } else {
            // A link's token names no one until Infra says whose it is
            const email = "email" in proof ? proof.email : null
            return failure(
                context,
                503,
                refused.reason,
                UNAVAILABLE,
                forTheTeam(context, email, refused.message)
            )
        }
    })

    // Ends this browser's session, whoever's it is
    .post("/auth/logout", async (context) => {
        const token = sessionToken(context)
        if (token !== undefined) {
            await endSession(context.var.database, token)
            await OTHERS.logOut(context, token)
        }
        clearSessionCookie(context)
        return context.json({ logged_out: true as const }, 200)
    })

/**
 * Why login failed, in Infra's words or its package's, as `cause`, for
 * whoever can act on it: one of the business's own people, by the address
 * they typed (`internal_users`, access.ts), or anyone on a dev server. A
 * visitor gets the plain message alone, since the cause can name the app's
 * keys and settings, which aren't theirs to read.
 */
function forTheTeam(
    context: Context<ApiEnvironment>,
    email: string | null,
    cause: string
): { cause: string } | Record<never, never> {
    const listed =
        email !== null &&
        listedInternal(context.var.access, email) !== undefined
    if (import.meta.env.DEV || listed) {
        return { cause }
    } else {
        return {}
    }
}
