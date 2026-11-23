import { z } from "zod"

// What Infra answers, parsed by the client (client.ts) so the rest of the
// app gets typed values, each refusal read into the app's own shape: its
// `error` as `reason`. README.md has each call's fields. The types the app
// uses come from these (index.ts), and the stand-in answers the same.

/** A login email that went out. */
export const started_login = z.object({
    // The address as Infra keeps it, which verifying the code takes
    email: z.string(),
    // Whether the email holds a link as well as the code
    with_link: z.boolean(),
    // When the code and the link stop working
    expires_at: z.iso.datetime().transform((value) => new Date(value)),
    // With a test key, which sends nothing: what the email would have held,
    // for a dev server to show on the page. Null with a secret key.
    test: z.object({ code: z.string(), link: z.string().nullable() }).nullable()
})

/** Why Infra didn't send a login email. */
export const start_refused = z.union([
    // This address was sent one less than a minute ago
    z
        .object({ error: z.literal("too-soon"), retry_after: z.number() })
        .transform(({ retry_after }) => ({
            reason: "too-soon" as const,
            retry_after
        })),
    // Over one of Infra's limits, an hour each: `email`, `ip` or `project`.
    // Kept as a string, so a limit Infra adds later still reads.
    z
        .object({
            error: z.literal("too-many"),
            limit: z.string(),
            retry_after: z.number()
        })
        .transform(({ limit, retry_after }) => ({
            reason: "too-many" as const,
            limit,
            retry_after
        })),
    // The email didn't go out, and nothing was counted, so asking again can
    // work at once
    z
        .object({ error: z.literal("not-sent") })
        .transform(() => ({ reason: "not-sent" as const }))
])

/** Whose email the code or the link was. */
export const verified_login = z.object({ email: z.string() })

/** Why what the visitor brought back didn't log them in. */
export const verify_refused = z.union([
    // Not the code, which still works for this many more tries
    z
        .object({ error: z.literal("wrong-code"), attempts_left: z.number() })
        .transform(({ attempts_left }) => ({
            reason: "wrong-code" as const,
            attempts_left
        })),
    // Nothing left to try: never sent, expired, already used, or out of
    // tries
    z
        .object({ error: z.literal("no-code") })
        .transform(() => ({ reason: "no-code" as const })),
    // The link is spent, expired, or never was this project's
    z
        .object({ error: z.literal("no-link") })
        .transform(() => ({ reason: "no-link" as const }))
])

/** A comment Infra kept: its ID, and when. */
export const kept_comment = z
    .object({
        comment: z.object({
            id: z.string(),
            created_at: z.iso.datetime().transform((value) => new Date(value))
        })
    })
    .transform(({ comment }) => comment)

/**
 * Why Infra didn't keep a comment. Either is a bug in what the app sent,
 * so sending it again won't help.
 */
export const comment_refused = z.union([
    // Not the call's shape: `fields` names what failed, like `element.tag`
    z
        .object({ error: z.literal("invalid"), fields: z.array(z.string()) })
        .transform(({ fields }) => ({ reason: "invalid" as const, fields })),
    // Over the most a call's body can be, in bytes
    z
        .object({ error: z.literal("too-large"), limit: z.number() })
        .transform(({ limit }) => ({ reason: "too-large" as const, limit }))
])
