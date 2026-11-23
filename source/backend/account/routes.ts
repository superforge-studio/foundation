import { Hono } from "hono"
import { z } from "zod"
import { account_change } from "@/utilities/schemas/users"
import { listedInternal } from "../auth/access"
import { inBrowser, loggedIn } from "../auth/logged-in"
import {
    endOtherSessions,
    endSessionById,
    listSessions
} from "../auth/sessions"
import type { ApiEnvironment } from "../context"
import { failure, validated } from "../failures"
import { renameUser } from "./rename"

// A session's id in a path: the start of its token's hash
// (auth/sessions.ts's `sessionId`)
const session_path = z.object({ id: z.string().regex(/^[0-9a-f]{16}$/) })

/**
 * The logged-in person's own account, under /api/account, whatever their
 * role: what they're called, and the browsers they're logged in on, with
 * logging out of the others. Their address is who they are, so it doesn't
 * change here, and neither does the name of one of the business's own,
 * which is the one they're listed with in code (auth/access.ts). Where
 * they're logged in is a browser's to see and end, never Claude's
 * (`inBrowser`).
 */
export const accountRoutes = new Hono<ApiEnvironment>()
    .patch(
        "/account",
        loggedIn,
        validated("json", account_change),
        async (context) => {
            if (listedInternal(context.var.access, context.var.user.email)) {
                return failure(
                    context,
                    409,
                    "listed",
                    "Your name is the one you're listed with in the app's code, so it changes there"
                )
            }
            const renamed = await renameUser(
                context.var.database,
                context.var.user.id,
                context.req.valid("json").name
            )
            return context.json({ name: renamed?.name ?? null }, 200)
        }
    )

    // Where they're logged in, this browser's session marked as current
    .get("/account/sessions", loggedIn, inBrowser, async (context) => {
        const sessions = await listSessions(
            context.var.database,
            context.var.user.id
        )
        return context.json(
            {
                sessions: sessions.map((session) => ({
                    ...session,
                    current: session.id === context.var.session.id
                }))
            },
            200
        )
    })

    // Logs one of their other browsers out. This one logs out through
    // /api/auth/logout, which clears its cookie too.
    .delete(
        "/account/sessions/:id",
        loggedIn,
        inBrowser,
        validated("param", session_path),
        async (context) => {
            const { id } = context.req.valid("param")
            if (id === context.var.session.id) {
                return failure(
                    context,
                    409,
                    "current",
                    "That's this browser: log out instead"
                )
            }
            const ended = await endSessionById(
                context.var.database,
                context.var.user.id,
                id
            )
            if (ended.ok) {
                return context.json({ ended: true as const }, 200)
            } else {
                return failure(context, 404, ended.error, "No such session")
            }
        }
    )

    // Logs every other browser out, keeping this one
    .post(
        "/account/sessions/logout-others",
        loggedIn,
        inBrowser,
        async (context) => {
            const ended = await endOtherSessions(
                context.var.database,
                context.var.user.id,
                context.var.session.id
            )
            console.info("Logged out everywhere else", {
                user_id: context.var.user.id,
                ended
            })
            return context.json({ ended }, 200)
        }
    )
