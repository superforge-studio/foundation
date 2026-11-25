import { mutationOptions, queryOptions } from "@tanstack/react-query"
import type { InferResponseType } from "hono/client"
import { client } from "@/backend/client"
import type { PageComment } from "@/utilities/schemas/comments"
import { FailedRequest, readFailure } from "./failures"

// Where the toolbar's comments go, and filing one
// (backend/comments/routes.ts), which the server sends on to Superforge
// Infra with who's logged in

/**
 * The board comments filed here go to: the project on Infra the server's
 * key is for, in its mode, or null when nothing would keep one, as on
 * Infra's stand-in, which says why.
 */
export type CommentBoard = InferResponseType<
    typeof client.api.comments.board.$get,
    200
>["board"]

/**
 * Where comments filed here go: GET /api/comments/board, which the
 * toolbar asks before it shows. Once a page: it changes only when the
 * server restarts, and asking again could take the toolbar away from under
 * a comment being written.
 */
export const commentBoardQuery = queryOptions({
    queryKey: ["comments", "board"],
    queryFn: async (): Promise<CommentBoard> => {
        const response = await client.api.comments.board.$get()
        if (response.status === 200) {
            const { board } = await response.json()
            return board
        } else {
            throw new FailedRequest(await readFailure(response))
        }
    },
    staleTime: Number.POSITIVE_INFINITY
})

/** A comment Infra kept: its ID, and when. */
export type FiledComment = InferResponseType<
    typeof client.api.comments.$post,
    201
>["comment"]

/** Filing a comment on an element of the page: POST /api/comments. */
export const fileComment = mutationOptions({
    mutationKey: ["comments", "file"],
    mutationFn: async (comment: PageComment): Promise<FiledComment> => {
        const response = await client.api.comments.$post({ json: comment })
        if (response.status === 201) {
            const { comment: filed } = await response.json()
            return filed
        } else {
            throw new FailedRequest(await readFailure(response))
        }
    }
})
