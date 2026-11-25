import type { DBOS } from "@dbos-inc/dbos-sdk"
import { APP_QUEUES } from "./app-events"

/**
 * The queues workflows run on, each registered with DBOS as it launches
 * (engine.ts). Every workflow goes on one (`queue` in `defineWorkflow`),
 * which is what lets a process put it there before DBOS has launched in it,
 * and what keeps a burst of them from all running at once. A queue meters
 * runs, not calls to an outside service: that service's wrapper paces its
 * own calls.
 *
 * A workflow that needs its own limits (one run at a time per customer, at
 * most so many a minute) gets a queue of its own, with DBOS's options:
 * `partitionConcurrency` with a partition key, `rateLimit`,
 * `globalConcurrency`. The template's are here, and this app's own in
 * ./app-events.ts (`APP_QUEUES`), never here.
 */
export const QUEUES = {
    // Anything that doesn't need its own: at most five running at once in
    // this process
    background: { workerConcurrency: 5 },
    ...APP_QUEUES
} satisfies Record<string, Parameters<typeof DBOS.registerQueue>[1]>

export type QueueName = keyof typeof QUEUES
