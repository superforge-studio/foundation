import type { DBOS } from "@dbos-inc/dbos-sdk"
import type { z } from "zod"

// This app's own events and queues, after the template's (./events.ts,
// ./queues.ts), where an update from the template never meets them. A file
// of their own, apart from ./app.ts: that one imports the app's
// workflows, and what they import reads the events as it loads.

/**
 * This app's own events, each by its name, `<record>-<verb>`, with the
 * shape of what it carries (./events.ts says what an event carries and
 * why), declared when the first workflow needs it, in the same change:
 *
 *   import { z } from "zod"
 *
 *   export const APP_EVENTS = {
 *       "order-paid": z.object({ order_id: z.uuid() })
 *   } satisfies Record<string, z.ZodType>
 */
export const APP_EVENTS = {} satisfies Record<string, z.ZodType>

/**
 * This app's own queues, for a workflow that needs limits of its own (one
 * run at a time per customer, at most so many a minute), with DBOS's
 * options (./queues.ts):
 *
 *   export const APP_QUEUES = {
 *       "per-customer": { partitionConcurrency: 1 }
 *   } satisfies Record<string, Parameters<typeof DBOS.registerQueue>[1]>
 */
export const APP_QUEUES = {} satisfies Record<
    string,
    Parameters<typeof DBOS.registerQueue>[1]
>
