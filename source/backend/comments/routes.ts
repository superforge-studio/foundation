import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { COMMENT_BODY_LIMIT, page_comment } from "@/utilities/schemas/comments"
import { loggedIn } from "../auth/logged-in"
import { visitorUserAgent } from "../auth/visitor"
import type { ApiEnvironment } from "../context"
import { failure, validated } from "../failures"
import { findBoard } from "./board"

/**
 * What the app's people say about it, under /api/comments: the toolbar on
 * every page (frontend/components/toolbar/) asks here where a comment
 * would go, and shows only when something keeps one; it posts each comment
 * on an element here, never to Infra, and the server sends it on with the
 * key and who filed it, for Superforge Infra to keep
 * (backend/infra/README.md, "Comments"). Anyone on the team, listed in
 * code (auth/app.ts), can file one, whatever their role, and a visitor
 * can't reach the owner's list.
 */
export const commentRoutes = new Hono<ApiEnvironment>()
    // Where a comment filed here goes: `{ board }`, the project on Infra
    // the server's key is for, in its mode, or `{ board: null, why }` when
    // nothing would keep one, on Infra's stand-in, with no key, a key Infra
    // refuses, or an Infra that doesn't answer, saying which and why
    // (./board.ts). The toolbar asks once a page, before it shows.
    .get("/comments/board", loggedIn, async (context) => {
        const found = await findBoard(
            context.var.infra,
            context.var.infra_using
        )
        if (found.ok) {
            return context.json({ board: found.data }, 200)
        } else {
            return context.json({ board: null, why: found.error }, 200)
        }
    })

    // A comment, `{ body, path, title, element, viewport }`. Answers 201
    // with its ID once Infra has kept it. An Infra that's down answers 503,
    // and one that refuses it 502, which is a bug here, logged; the page
    // keeps what was written, so it can be sent again.
    .post(
        "/comments",
        bodyLimit({
            maxSize: COMMENT_BODY_LIMIT,
            onError: (context) =>
                failure(context, 413, "too-large", "A comment is at most 32 KB")
        }),
        loggedIn,
        validated("json", page_comment),
        async (context) => {
            const comment = context.req.valid("json")
            const user_agent = visitorUserAgent(context)
            const filed = await context.var.infra.fileComment({
                ...comment,
                user_id: context.var.user.id,
                user_name: context.var.user.first_name,
                user_agent: user_agent === "" ? null : user_agent
            })
            if (filed.ok) {
                const { id, created_at } = filed.data
                return context.json(
                    { comment: { id, created_at: created_at.toISOString() } },
                    201
                )
            } else if (filed.error.reason === "unavailable") {
                return failure(
                    context,
                    503,
                    "unavailable",
                    "Comments can't reach Superforge Infra right now"
                )
            } else {
                return failure(
                    context,
                    502,
                    "refused",
                    "Superforge Infra didn't take the comment"
                )
            }
        }
    )
