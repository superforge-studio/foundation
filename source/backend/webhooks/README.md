# Webhooks

Where other services post the app what happened on their side: a payment
on Stripe, a contact changed on HighLevel, an email bounced on Resend. Each
posts to **`/api/webhooks/<source>`**, and each delivery is kept as it
came, checked to be its source's, and turned into events
(`backend/workflows/events.ts`), which the workflows on them take from
there, with their retries (`backend/workflows/README.md`, "Events"). The
template lists no source: a copy adds one the day it wires up a service.

## A delivery

`routes.ts` answers each one, and `deliveries.ts`'s `takeDelivery` does
the work:

1. **The source**, by the path's last part, from `SOURCES` (`sources.ts`),
   which the API hands every route as `context.var.webhook_sources`. One
   that isn't listed is 404 `not-found`, and nothing is kept, but it's
   logged as a miss (`backend/misses/`), as a warning when it's signed
   like a webhook: a sender given the wrong address shows up in
   `railway logs --filter "looks meant for the app"`.
2. **Kept as it came, first**: a row in `internal.webhook_deliveries`, with
   its headers (all but `authorization`, `cookie` and
   `proxy-authorization`), its body exactly as it came, which its
   signature is over, and the sender's own ID for it, when it has one. So a
   delivery that's refused or fails can still be read, and checked again,
   with SQL.
3. **Checked**: the source's `verify`. One that isn't its source's is
   `refused`, 401 `bad-signature`; one whose source's secret isn't set is
   `refused` too, 503 `unconfigured`, which a sender tries again later.
4. **Read**: the source's `events`, the events it means. A body that
   isn't what the source sends is `failed`, 400 `unreadable`, with what
   didn't fit. One that says nothing the app acts on is `ignored`.
5. **Queued**: each event, with `queueEvent`, in one transaction with the
   row's outcome, `accepted`, and the runs it queued, in `events`. Each
   event is named for the sender's ID for the delivery
   (`<source>-<delivery id>-<index>`), or the ID the source gives it, so a
   retry of the same delivery queues each workflow once.

It's answered 200 once it's taken, whatever it queued. A sender's retry
is a new row, with the same `delivery_id`.

**No one signs in for a webhook**: its signature says who sent it. The
route is mounted ahead of the API's check for another site's forms
(`backend/index.ts`), since some senders, like Twilio, post forms, and
none sends an Origin. A body is at most 2 MB (413 `too-large`).

**A source never does the work itself.** It only reads what came and
says what it means; the workflows on its events do the rest, outside the
request, so the sender hears back at once, and a step that fails tries
again rather than making the sender send it again.

## Adding a source

A source is a file of its own here, listed in `SOURCES`:

```typescript
// backend/webhooks/stripe.ts
export const stripe: WebhookSource = {
    name: "stripe",
    verify: (delivery) =>
        verifyStripe(delivery, process.env.STRIPE_WEBHOOK_SECRET),
    deliveryId: (delivery) => stripeEventId(delivery.body),
    events: (delivery) => {
        const read = readJson(delivery, stripe_event)
        if (!read.ok) {
            return read
        } else if (read.data.type === "checkout.session.completed") {
            return {
                ok: true,
                data: [
                    {
                        name: "stripe-checkout-completed",
                        data: { session_id: read.data.data.object.id }
                    }
                ]
            }
        } else {
            return { ok: true, data: [] }
        }
    }
}
```

1. **Its events**, in `backend/workflows/events.ts`'s `EVENTS`, each
   `<source>-<what happened>` (`stripe-checkout-completed`), carrying the
   IDs a workflow needs to read the rest from the service.
2. **Its signature.** A source that signs as Standard Webhooks says, as
   Resend does (through Svix) and Infra will, is
   `standardWebhooksSource({ name, secret, events })`, which checks it
   with `standard.ts` and takes `webhook-id` as the delivery's ID. Any
   other checks the sender's own way (Stripe's `Stripe-Signature`,
   HighLevel's), always with `timingSafeEqual`, and against the body as it
   came, never one parsed and written out again.
3. **Its secret**, a Railway variable on the app's service
   (`STRIPE_WEBHOOK_SECRET`), in `.railway/railway.ts`, whose value the
   owner sets in Railway's dashboard. Until it's set, its deliveries are
   refused with 503, which the sender tries again.
4. **Its body**, read with `readJson(delivery, schema)`, a zod schema of
   only what the app uses, so a field the sender adds later changes
   nothing.
5. **The address**, `https://<the app's domain>/api/webhooks/<name>`, set
   in the service's dashboard. That's the owner's step.
6. **A test**, through `testApi({ webhook_sources: [source] })`, posting
   a signed delivery and reading back what it queued with `queued()`, as
   `tests/routes.test.ts` does.

## What's kept

`internal.webhook_deliveries` is a log of what came, for 30 days
(`KEEP_DELIVERIES_FOR`, `prune.ts`), deleted each hour by the
`prune-webhook-deliveries` workflow, on a schedule and quiet
(`workflows.ts`). What a delivery meant is in the runs
it queued, on the Workflows screen. Its outcome is one of
`utilities/webhooks.ts`'s list. A delivery still `received` is one the
server stopped while handling: the sender, which heard nothing, sends it
again.

To find one a sender says it sent:

```bash
pnpm database:sql "select received_at, outcome, problem, events from internal.webhook_deliveries where source = 'stripe' order by received_at desc limit 20"
```
