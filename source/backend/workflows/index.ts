import { JOBS } from "@/backend/jobs"
import {
    tellTeamOfNewMember,
    tellTeamOfSignUp
} from "@/backend/users/workflows"
import { pruneAnalyticsRunner } from "@/backend/visits/prune"
import { pruneWebhookDeliveries } from "@/backend/webhooks/workflows"
import type { Workflow } from "./define"
import type { Runner } from "./runners"

/**
 * Every workflow there is, from each feature's `workflows.ts`, registered
 * with DBOS before it launches (engine.ts). A workflow left out of this
 * list never runs, and starting one throws, so a new one goes here the
 * moment it's defined:
 *
 *   import { notifyOwner } from "@/backend/contacts/workflows"
 *
 *   export const WORKFLOWS: Workflow[] = [notifyOwner]
 *
 * One that has shipped stays listed until no run of it is left (README.md,
 * "Changing a workflow").
 */
export const WORKFLOWS: Workflow[] = [
    tellTeamOfNewMember,
    // Until the next release: nothing starts it now, but a copy's runs may
    // still be in flight
    tellTeamOfSignUp,
    // Each hour, the webhooks older than they're kept (backend/webhooks/)
    pruneWebhookDeliveries,
    // Each job's, which makes its change (backend/jobs/)
    ...JOBS.map((job) => job.workflow)
]

/**
 * Every runner there is (runners.ts): what checks for something due, every
 * few seconds, while this process runs the workflows. A feature's goes here
 * the moment it's defined.
 */
export const RUNNERS: Runner[] = [
    // Each hour, the analytics older than it's kept (backend/visits/)
    pruneAnalyticsRunner
]
