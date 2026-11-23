import { z } from "zod"
import { page_comment } from "@/utilities/schemas/comments"
import { app_user_id } from "@/utilities/schemas/events"

// What the app's server sends Infra for the toolbar, through `fileComment`
// (index.ts): a comment someone logged in wrote about an element of a page,
// which the toolbar posted to the app's own /api/comments
// (backend/comments/), with who they are. README.md, "Comments", has the
// call.

/**
 * One call's body, as Infra checks it: the toolbar's comment, the app's
 * own ID for whoever filed it, never their email, and their browser's
 * User-Agent, for what they were on, which Infra doesn't keep. The
 * stand-in checks it as Infra does (stand-in.ts).
 */
export const filed_comment = page_comment.extend({
    user: app_user_id.nullable(),
    user_agent: z.string().max(1024).nullable()
})
export type FiledComment = z.infer<typeof filed_comment>
