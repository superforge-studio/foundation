// What came of a webhook another service posted the app
// (backend/webhooks/), the fixed list `webhook_deliveries.outcome`'s check
// is made from:
// - `received`: kept, and not yet settled, which a delivery stays only when
//   the server stopped while it was handled
// - `refused`: its signature didn't check out, or its source's secret isn't
//   set, so nothing came of it
// - `ignored`: it checked out, and says nothing the app acts on
// - `accepted`: it checked out, and queued its events
// - `failed`: it checked out, but its body wasn't what its source sends, or
//   queueing its events failed
export const WEBHOOK_OUTCOMES = [
    "received",
    "refused",
    "ignored",
    "accepted",
    "failed"
] as const

export type WebhookOutcome = (typeof WEBHOOK_OUTCOMES)[number]
