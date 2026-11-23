import type { Workflow } from "./define"
import type { Runner } from "./runners"

/**
 * This app's own workflows, registered after the template's (./index.ts),
 * from each of its features' `workflows.ts`. A workflow left out never
 * runs, and starting one throws, so a new one goes here the moment it's
 * defined:
 *
 *   import { notifyOwner } from "@/backend/orders/workflows"
 *
 *   export const APP_WORKFLOWS: Workflow[] = [notifyOwner]
 *
 * One that has shipped stays listed until no run of it is left (README.md,
 * "Changing a workflow"). They're here, apart from the template's, so an
 * update from the template never meets them.
 */
export const APP_WORKFLOWS: Workflow[] = []

/**
 * This app's own runners, after the template's (./index.ts): what checks
 * for something due, every few seconds, while this process runs the
 * workflows (./runners.ts).
 */
export const APP_RUNNERS: Runner[] = []
