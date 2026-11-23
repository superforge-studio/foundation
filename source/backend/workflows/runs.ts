import type { DBOS, WorkflowStatus } from "@dbos-inc/dbos-sdk"
import type { Workflow } from "./define"

// A step as DBOS lists it, which its package doesn't name
type StepInfo = NonNullable<
    Awaited<ReturnType<typeof DBOS.listWorkflowSteps>>
>[number]

// Runs of the workflows as the dashboard and the API show them: what DBOS
// says of each (engine.ts asks it through its own functions, never its
// tables), in words a person reads, with times as ISO strings and what went
// in and out as JSON text.

/** Where a run is: waiting its turn, running, finished, failed or stopped. */
export type RunStatus =
    | "queued"
    | "running"
    | "succeeded"
    | "failed"
    | "canceled"

/** A run, as the list of runs shows it. */
export type Run = {
    id: string
    workflow: string
    // What it's called, from its workflow's `title` and its input
    title: string
    status: RunStatus
    // What it was started with, as JSON
    input: string
    // What made it fail, for a failed run
    error: string | null
    created_at: string
    completed_at: string | null
}

/** A step a run has finished, or failed at. */
export type RunStep = {
    // Its place in the run, from 0, as DBOS counts it
    number: number
    name: string
    status: "done" | "failed"
    output: string | null
    error: string | null
    started_at: string | null
    completed_at: string | null
}

/** A run with what it returned and its steps, for its own page. */
export type RunWithSteps = Run & { output: string | null; steps: RunStep[] }

/** What DBOS's statuses mean, in a run's words. */
export function runStatus(status: string): RunStatus {
    switch (status) {
        case "ENQUEUED":
        case "DELAYED":
            return "queued"
        case "PENDING":
            return "running"
        case "SUCCESS":
            return "succeeded"
        case "CANCELLED":
            return "canceled"
        default:
            // ERROR, and MAX_RECOVERY_ATTEMPTS_EXCEEDED: a run that kept
            // crashing its process
            return "failed"
    }
}

/**
 * Whether a run belongs on the list of runs: every one but a quiet
 * workflow's (`quiet` in `defineWorkflow`), which shows only once it has
 * failed. A quiet run still opens by its id.
 */
export function worthListing(
    status: Pick<WorkflowStatus, "workflowName" | "status">,
    quiet: Set<string>
) {
    return (
        !quiet.has(status.workflowName) || runStatus(status.status) === "failed"
    )
}

/** A run from what DBOS says of it, named by its workflow when it has one. */
export function runOf(status: WorkflowStatus, workflows: Workflow[]): Run {
    // DBOS keeps a run's arguments as a list; a workflow here takes one
    const input = status.input?.[0]
    const workflow = workflows.find((each) => each.name === status.workflowName)
    const finished = !["ENQUEUED", "DELAYED", "PENDING"].includes(status.status)
    const completed =
        status.completedAt ?? (finished ? status.updatedAt : undefined)
    return {
        id: status.workflowID,
        workflow: status.workflowName,
        title: workflow?.title(input) ?? status.workflowName,
        status: runStatus(status.status),
        input: asJson(input) ?? "null",
        error: status.error === undefined ? null : describeError(status.error),
        created_at: new Date(status.createdAt).toISOString(),
        completed_at:
            completed === undefined ? null : new Date(completed).toISOString()
    }
}

/** A run with what it returned and its steps, for its own page. */
export function runWithStepsOf(
    status: WorkflowStatus,
    steps: StepInfo[],
    workflows: Workflow[]
): RunWithSteps {
    return {
        ...runOf(status, workflows),
        output: asJson(status.output),
        steps: steps.map(stepOf)
    }
}

/** A run's step from what DBOS says of it. */
export function stepOf(step: StepInfo): RunStep {
    return {
        number: step.functionID,
        name: step.name,
        status: step.error === null ? "done" : "failed",
        output: step.error === null ? asJson(step.output) : null,
        error: step.error === null ? null : describeError(step.error),
        started_at: isoOrNull(step.startedAtEpochMs),
        completed_at: isoOrNull(step.completedAtEpochMs)
    }
}

/**
 * Where a stopped run starts again: the step it failed at, so the ones
 * before keep what they returned, or just after the last it finished,
 * when it stopped between steps.
 */
export function retryFrom(steps: RunStep[]) {
    const failed = steps.find((step) => step.status === "failed")
    if (failed !== undefined) {
        return failed.number
    } else {
        return Math.max(-1, ...steps.map((step) => step.number)) + 1
    }
}

function isoOrNull(epoch: number | undefined) {
    return epoch === undefined ? null : new Date(epoch).toISOString()
}

// A value as JSON text for a person to read, or null for nothing at all
function asJson(value: unknown) {
    if (value === undefined) {
        return null
    } else {
        try {
            return JSON.stringify(value, null, 2) ?? null
        } catch (error) {
            console.warn("A run's value couldn't be shown as JSON", { error })
            return String(value)
        }
    }
}

// What an error says, however DBOS kept it: an Error, or what one was
// serialized to
function describeError(error: unknown): string {
    if (error instanceof Error) {
        return error.message
    } else if (typeof error === "string") {
        return error
    } else if (
        typeof error === "object" &&
        error !== null &&
        "message" in error &&
        typeof error.message === "string"
    ) {
        return error.message
    } else {
        return asJson(error) ?? "It failed without saying why"
    }
}
