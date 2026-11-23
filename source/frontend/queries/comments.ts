import { mutationOptions } from "@tanstack/react-query"
import type { InferResponseType } from "hono/client"
import { client } from "@/backend/client"
import type { PageComment } from "@/utilities/schemas/comments"
import { FailedRequest, readFailure } from "./failures"

// Filing a comment from the toolbar (backend/comments/routes.ts), which the
// server sends on to Superforge Infra with who's logged in

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
