import { zValidator } from "@hono/zod-validator"
import type { Context, ErrorHandler, NotFoundHandler } from "hono"
import { HTTPException } from "hono/http-exception"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import type { z } from "zod"
import { recordError, withoutValues } from "@/utilities/tracing"
import { logMiss } from "./misses/log"

// How every route fails, in the one shape the site, scripts and agents all
// read (utilities/schemas/failures.ts): `{ error: { reason, message } }`,
// with the status that says what kind of failure it is.

/**
 * Answers `status` with a failure: `reason` for a program to branch on,
 * `message` for a person, and any `details` a caller can act on, like a
 * 429's `retry_after` (utilities/schemas/failures.ts has the ones a page
 * reads). The typed client knows the reason and the details, so a page can
 * tell one failure from another.
 */
export function failure<
    Reason extends string,
    Status extends ContentfulStatusCode,
    Details extends Record<string, string | number | boolean> = Record<
        never,
        never
    >
>(
    context: Context,
    status: Status,
    reason: Reason,
    message: string,
    details?: Details
) {
    return context.json({ error: { ...details, reason, message } }, status)
}

/**
 * A route's input checked with zod, `target` being what's checked: the
 * `json` body, the `param`s in its path, the `query`. The handler reads it
 * with `context.req.valid(target)`, and the typed client knows its shape.
 * Input that doesn't fit is answered 400 with `invalid`, and what didn't
 * fit, field by field, so a form can say which. Every route checks its
 * input this way, with a schema from utilities/schemas/ when a form checks
 * the same.
 */
export function validated<
    Target extends "json" | "param" | "query" | "form" | "header" | "cookie",
    Schema extends z.ZodType
>(target: Target, schema: Schema) {
    return zValidator(target, schema, (result, context) => {
        if (!result.success) {
            return context.json(
                {
                    error: {
                        reason: "invalid" as const,
                        message:
                            "The request doesn't fit what this route takes",
                        issues: result.error.issues.map((issue) => ({
                            path: issue.path.join("."),
                            message: issue.message
                        }))
                    }
                },
                400
            )
        }
    })
}

/**
 * A path under /api that no route answers, logged (misses/log.ts): the API
 * says so itself, since its routes answer 404 too, for what isn't there,
 * which isn't a miss.
 */
export const answerNotFound: NotFoundHandler = (context) => {
    logMiss(context.req.raw, 404)
    return failure(context, 404, "not-found", "No route answers this path")
}

/**
 * A body larger than its route takes, for `bodyLimit`'s `onError`: 413
 * `too-large`.
 */
export function tooLarge(context: Context) {
    return failure(
        context,
        413,
        "too-large",
        "The request's body is larger than this route takes"
    )
}

/**
 * A route that threw: a bug, or something it was never meant to handle,
 * since an expected failure is answered, not thrown. It's logged, its
 * request's span is marked failed with the error (utilities/tracing.ts),
 * and the caller learns only that it failed. A query that failed is logged
 * by its statement and Postgres's own words, never the values it was sent
 * (`withoutValues`). Hono's own refusals throw too, before the route runs,
 * and are answered as what they are: a body that isn't JSON is 400
 * `invalid`, and any other its own status, as `refused`.
 */
export const answerUnexpected: ErrorHandler = (error, context) => {
    const request = { method: context.req.method, path: context.req.path }
    if (error instanceof HTTPException && error.status === 400) {
        console.warn("A request's body couldn't be read", {
            ...request,
            message: error.message
        })
        return failure(
            context,
            400,
            "invalid",
            "The request doesn't fit what this route takes"
        )
    } else if (error instanceof HTTPException) {
        console.warn("A request was refused", {
            ...request,
            status: error.status
        })
        return failure(
            context,
            error.status,
            "refused",
            "This request can't be answered"
        )
    } else {
        const kept = withoutValues(error)
        console.error("A route threw", { ...request, error: kept })
        recordError(error)
        return failure(context, 500, "unexpected", "Something went wrong")
    }
}
