import { Hono } from "hono"
import type { Database } from "@/database"
import { sign_in_start, sign_in_verify } from "@/utilities/schemas/auth"
import type { ApiEnvironment } from "../context"
import { failure, validated } from "../failures"
import { keptVisitorId } from "../visits/cookies"
import { recordEvents } from "../visits/record"
import { endSession } from "./sessions"
import { maySignIn, signIn } from "./sign-in"
import {
    clearSessionCookie,
    maybeSignedIn,
    sessionToken,
    setSessionCookie
} from "./signed-in"
import { appOrigin, visitorBrowser, visitorIp } from "./visitor"

// What the page says when Infra can't be asked: the reason the route
// answers, and why, for whoever reads the logs
const UNAVAILABLE = "Sign-in isn't working right now. Try again soon."

// What someone hears when only listed people may sign in, and they aren't
// (access.ts)
const NOT_LISTED =
    "This address can't sign in here. Ask whoever runs this site to add you."

/**
 * Signing in, under /api/auth, with no password: Infra emails a six-digit
 * code and a link, and says whose email the code or the link is when the
 * visitor brings one back (backend/infra/). The app keeps the user and the
 * session. Starting and verifying take JSON, which a form on another site
 * can't send; signing out takes no body, and the API refuses another
 * site's form (`csrf()` in index.ts). The cookie is SameSite=Lax, so
 * another site's page can't act as anyone (signed-in.ts).
 */
export const authRoutes = new Hono<ApiEnvironment>()
    // Who's signed in, or null for a visitor: what every page asks
    .get("/auth/session", maybeSignedIn, (context) =>
        context.json({ user: context.var.user }, 200)
    )

    // Emails the code, and the link back to /sign-in when this is one of
    // the project's domains. In a dev server, which emails nothing, the
    // answer holds the code and the link for the page to show. When only
    // listed people may sign in, anyone else is refused before Infra is
    // asked, so nothing is emailed to them.
    .post("/auth/start", validated("json", sign_in_start), async (context) => {
        const { email } = context.req.valid("json")
        if (
            !(await maySignIn(context.var.database, context.var.access, email))
        ) {
            return failure(context, 403, "not-listed", NOT_LISTED)
        }
        const started = await context.var.infra.startSignIn({
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
                "Too many sign-in emails for now",
                { retry_after: refused.retry_after, limit: refused.limit }
            )
        } else if (refused.reason === "not-sent") {
            return failure(
                context,
                502,
                refused.reason,
                "The email didn't go out. Asking again can work at once."
            )
        } else {
            return failure(context, 503, refused.reason, UNAVAILABLE)
        }
    })

    // Signs in with the code the visitor typed, or the link's token, which
    // the sign-in page posts from the link's fragment (`/sign-in#<token>`)
    // once the visitor presses to finish, so it stays out of addresses and
    // logs, and a mail scanner that opens the link spends nothing
    .post(
        "/auth/verify",
        validated("json", sign_in_verify),
        async (context) => {
            const verified = await context.var.infra.verifySignIn(
                context.req.valid("json")
            )
            if (verified.ok) {
                const signed_in = await signIn(context.var.database, {
                    email: verified.data.email,
                    replacing: sessionToken(context),
                    user_agent: visitorBrowser(context),
                    access: context.var.access
                })
                if (!signed_in.ok) {
                    return failure(context, 403, signed_in.error, NOT_LISTED)
                }
                const { user, token, joined } = signed_in.data
                setSessionCookie(context, token)
                console.info("Signed in", { user_id: user.id, joined })
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
                return failure(context, 503, refused.reason, UNAVAILABLE)
            }
        }
    )

    // Ends this browser's session
    .post("/auth/sign-out", async (context) => {
        const token = sessionToken(context)
        if (token !== undefined) {
            await endSession(context.var.database, token)
        }
        clearSessionCookie(context)
        return context.json({ signed_out: true as const }, 200)
    })

// Records that someone new has signed up, as a `signed-up` event with their
// user's ID, and their browser's when the site remembers it, which joins
// the sign-up to the visits that led to it (backend/visits/README.md). One
// that fails is logged and leaves them signed in: an event is never worth
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
