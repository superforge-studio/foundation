import { type Context, Hono } from "hono"
import type { Database } from "@/database"
import { login_start, login_verify } from "@/utilities/schemas/auth"
import type { ApiEnvironment } from "../context"
import { failure, validated } from "../failures"
import { keptVisitorId } from "../visits/cookies"
import { recordEvents } from "../visits/record"
import { listedInternal } from "./access"
import {
    clearSessionCookie,
    maybeLoggedIn,
    sessionToken,
    setSessionCookie
} from "./logged-in"
import { logIn, mayLogIn } from "./login"
import { endSession } from "./sessions"
import { appOrigin, visitorBrowser, visitorIp } from "./visitor"

// What the page says when Infra can't be asked: the reason the route
// answers. Why, in Infra's words or its package's, goes to the logs, and
// to the business's own people (`forTheTeam`)
const UNAVAILABLE = "Login isn't working right now. Try again soon."

// What someone hears when only listed people may log in, and they aren't
// (access.ts)
const NOT_LISTED =
    "This address can't log in here. Ask whoever runs this site to add you."

/**
 * Logging in, under /api/auth, with no password: Infra emails a six-digit
 * code and a link, and says whose email the code or the link is when the
 * visitor brings one back (backend/infra/). The app keeps the user and the
 * session. Starting and verifying take JSON, which a form on another site
 * can't send; logging out takes no body, and the API refuses another
 * site's form (`csrf()` in index.ts). The cookie is SameSite=Lax, so
 * another site's page can't act as anyone (logged-in.ts).
 */
export const authRoutes = new Hono<ApiEnvironment>()
    // Who's logged in, or null for a visitor: what every page asks
    .get("/auth/session", maybeLoggedIn, (context) =>
        context.json({ user: context.var.user }, 200)
    )

    // Emails the code, and the link back to /login when this is one of
    // the project's domains. In a dev server, which emails nothing, the
    // answer holds the code and the link for the page to show. When only
    // listed people may log in, anyone else is refused before Infra is
    // asked, so nothing is emailed to them.
    .post("/auth/start", validated("json", login_start), async (context) => {
        const { email } = context.req.valid("json")
        if (
            !(await mayLogIn(context.var.database, context.var.access, email))
        ) {
            return failure(context, 403, "not-listed", NOT_LISTED)
        }
        const started = await context.var.infra.startLogin({
            email,
            ip: visitorIp(context),
            origin: appOrigin(context)
        })
        if (started.ok) {
            const { test, ...sent } = started.data
            return context.json(
                {
                    ...sent,
                    // Never in a build, which takes only a secret key, so
                    // Infra sends the email and answers no test
                    development: import.meta.env.DEV ? test : null
                },
                200
            )
        }

        const refused = started.error
        if (refused.reason === "too-soon") {
            context.header("Retry-After", String(refused.retry_after))
            return failure(
                context,
                429,
                refused.reason,
                "A code went to this address less than a minute ago",
                { retry_after: refused.retry_after }
            )
        } else if (refused.reason === "too-many") {
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
        const verified = await context.var.infra.verifyLogin(proof)
        if (verified.ok) {
            const logged_in = await logIn(context.var.database, {
                email: verified.data.email,
                replacing: sessionToken(context),
                user_agent: visitorBrowser(context),
                access: context.var.access
            })
            if (!logged_in.ok) {
                return failure(context, 403, logged_in.error, NOT_LISTED)
            }
            const { user, token, joined } = logged_in.data
            setSessionCookie(context, token)
            console.info("Logged in", { user_id: user.id, joined })
            if (joined) {
                await recordSignUp(context.var.database, {
                    user_id: user.id,
                    visitor_id: keptVisitorId(context) ?? undefined
                })
            }
            return context.json({ user }, 200)
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

    // Ends this browser's session
    .post("/auth/logout", async (context) => {
        const token = sessionToken(context)
        if (token !== undefined) {
            await endSession(context.var.database, token)
        }
        clearSessionCookie(context)
        return context.json({ logged_out: true as const }, 200)
    })

// Records that someone new has signed up, as a `signed-up` event with their
// user's ID, and their browser's when the site remembers it, which joins
// the sign-up to the visits that led to it (backend/visits/README.md). One
// that fails is logged and leaves them logged in: an event is never worth
// failing a request over.
async function recordSignUp(
    database: Database,
    who: { user_id: string; visitor_id: string | undefined }
) {
    try {
        await recordEvents(database, [{ name: "signed-up", ...who }])
    } catch (error) {
        console.error("The sign-up's event wasn't recorded", {
            user_id: who.user_id,
            error
        })
    }
}

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
