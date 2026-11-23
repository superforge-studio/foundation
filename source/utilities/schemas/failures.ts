import { z } from "zod"

/** What went wrong, in a failure the API answers. */
export const failure_details = z.object({
    // For a program to branch on: a kebab-case word or two, like "invalid",
    // "not-found" or "logged-out", that never changes once a route answers
    // with it
    reason: z.string(),
    // The same for a person, in a sentence
    message: z.string(),
    // For "invalid": what in the request didn't fit, field by field
    issues: z
        .array(z.object({ path: z.string(), message: z.string() }))
        .optional(),
    // For a failure that passes with time, like a 429: about how many
    // seconds until asking again can work, which its Retry-After header says
    // too
    retry_after: z.number().optional(),
    // For "not-permitted": the area of the app the route is in, and the
    // level of it the route needed, which the person's role doesn't reach
    // (utilities/permissions.ts)
    area: z.string().optional(),
    level: z.string().optional(),
    // Why it failed, in plain words, from whatever refused, like Infra's
    // message, with what fixes it: only ever for the business's own people
    // or a dev server, never a visitor, since it can name the app's keys
    // and settings
    cause: z.string().optional()
})
export type ApiFailure = z.infer<typeof failure_details>

/**
 * How every route under /api answers when it fails, so the site, scripts
 * and agents read a failure the same way, whatever route it came from.
 * The API answers with it (backend/failures.ts), and a page reads it back
 * (frontend/queries/failures.ts). Change it only by adding optional fields:
 * whatever reads it was written against this shape.
 */
export const api_failure = z.object({ error: failure_details })
