import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { EVENTS_BODY_LIMIT } from "@/utilities/schemas/events"
import { consent_answer, page_batch } from "@/utilities/schemas/visits"
import { maybeLoggedIn } from "../auth/logged-in"
import { visitorIp, visitorUserAgent } from "../auth/visitor"
import type { ApiEnvironment } from "../context"
import { failure, validated } from "../failures"
import {
    forgetVisitor,
    keepConsent,
    keptConsent,
    keptVisitorId,
    rememberVisitor
} from "./cookies"
import { recordVisit } from "./record"

/**
 * What visitors do on the site's pages, under /api/visits: the pages'
 * script (frontend/visitors/) posts its events here, to the site's own
 * address, so an ad blocker sees nothing to block. The server adds who the
 * visitor is, what they answered and where they are, keeps the events in
 * its own database (record.ts), and decides by `context.var.visitor_mode`
 * (utilities/visitors.ts) whether the site remembers them, with the
 * `visitor` cookie (cookies.ts), and whether their page asks them first
 * (README.md).
 */
export const visitRoutes = new Hono<ApiEnvironment>()
    // A batch of the page's events, `{ sent_at, events }`. Answers whether
    // the page asks the visitor, and sets, renews or clears their
    // `visitor` cookie by whether the site remembers them. A database
    // that's down fails the batch (500), which the page sends again: it's
    // kept whole or not at all.
    .post(
        "/visits",
        bodyLimit({
            maxSize: EVENTS_BODY_LIMIT,
            onError: (context) =>
                failure(
                    context,
                    413,
                    "too-large",
                    "A batch of a page's events is at most 64 KB"
                )
        }),
        validated("json", page_batch),
        maybeLoggedIn,
        async (context) => {
            const { sent_at, events } = context.req.valid("json")
            const mode = context.var.visitor_mode
            const kept_id = keptVisitorId(context)
            // The ID the cookie holds, or a new one, which the cookie holds
            // once the site remembers them; none at all in `never`
            const id =
                mode === "never" ? null : (kept_id ?? crypto.randomUUID())
            const { remembered, ask } = await recordVisit(context.var, {
                mode,
                visitor: {
                    id,
                    consent: keptConsent(context),
                    user_id: context.var.user?.id ?? null,
                    ip: visitorIp(context),
                    user_agent: visitorUserAgent(context)
                },
                sent_at,
                events
            })

            if (remembered && id !== null) {
                // Set, or renewed for another 400 days
                rememberVisitor(context, id)
            } else if (!remembered && kept_id !== undefined) {
                forgetVisitor(context)
            }
            return context.json({ ask }, 200)
        }
    )

    // What the visitor answered the banner, kept in `visitor_consent`, which
    // every batch after it is decided by. Declining forgets their `visitor`
    // cookie at once; accepting lets the next batch's answer set it.
    .post(
        "/visits/consent",
        validated("json", consent_answer),
        async (context) => {
            const { consent } = context.req.valid("json")
            keepConsent(context, consent)
            if (consent === "declined") {
                forgetVisitor(context)
            }
            return context.body(null, 204)
        }
    )
