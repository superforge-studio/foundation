import { Hono } from "hono"
import { z } from "zod"
import { api_token_creation } from "@/utilities/schemas/api-tokens"
import { account_change } from "@/utilities/schemas/users"
import { listedInternal } from "../auth/access"
import { listApiTokens, makeApiToken, revokeApiToken } from "../auth/api-tokens"
import { inBrowser, internalOnly, loggedIn } from "../auth/logged-in"
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

// An API token's id in a path
const api_token_path = z.object({ id: z.uuid() })

/**
 * The logged-in person's own account, under /api/account, whatever their
 * role: what they're called, and the browsers they're logged in on, with
 * logging out of the others, and for one of the business's own, their API
 * tokens. Their address is who they are, so it doesn't change here, and
 * neither does the name of one of the business's own, which is the one
 * they're listed with in code (auth/access.ts). Where they're logged in,
 * and their tokens, are a browser's to see and change, never a token's
 * (`inBrowser`), so a token that leaks can't make another.
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

    // Their API tokens, newest first, never the tokens themselves
    .get("/account/tokens", internalOnly, inBrowser, async (context) => {
        const tokens = await listApiTokens(
            context.var.database,
            context.var.user.id
        )
        return context.json({ tokens }, 200)
    })

    // Makes one, as them, answering the token itself, which nothing shows
    // again
    .post(
        "/account/tokens",
        internalOnly,
        inBrowser,
        validated("json", api_token_creation),
        async (context) => {
            const made = await makeApiToken(
                context.var.database,
                context.var.user.id,
                context.req.valid("json")
            )
            console.info("API token made", {
                user_id: context.var.user.id,
                api_token_id: made.api_token.id,
                scopes: made.api_token.scopes
            })
            return context.json(made, 200)
        }
    )

    // Revokes one of their own, so the next request with it is refused
    .delete(
        "/account/tokens/:id",
        internalOnly,
        inBrowser,
        validated("param", api_token_path),
        async (context) => {
            const { id } = context.req.valid("param")
            const revoked = await revokeApiToken(
                context.var.database,
                context.var.user.id,
                id
            )
            if (revoked.ok) {
                console.info("API token revoked", {
                    user_id: context.var.user.id,
                    api_token_id: id
                })
                return context.json({ revoked: true as const }, 200)
            } else {
                return failure(
                    context,
                    404,
                    revoked.error,
                    "No token of yours has that ID"
                )
            }
        }
    )
