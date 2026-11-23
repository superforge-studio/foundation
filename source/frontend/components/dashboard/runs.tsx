import { useMutation, useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { RotateCcw } from "lucide-react"
import { Button } from "@/frontend/components/primitives/button"
import { useSession } from "@/frontend/queries/auth"
import { failureOf } from "@/frontend/queries/failures"
import {
    type RunSummary,
    retryRun,
    runQuery
} from "@/frontend/queries/workflows"
import { allows } from "@/utilities/permissions"
import {
    RunLine,
    RunStatusMark,
    runStop,
    StepRail,
    Stop,
    useNow
} from "./marks"
import { BackToList, CouldNotLoad, sectionHeading } from "./shell"
import { moment, since, took } from "./words"

// The Workflows screen's two halves: the runs, by what needs a look first,
// and the one chosen, its steps down its own line

/** The runs, failed and canceled first, then running, then done. */
export function RunList({
    runs,
    chosen,
    now
}: {
    runs: RunSummary[]
    chosen: string | undefined
    now: Date
}) {
    const attention = runs.filter(
        (run) => run.status === "failed" || run.status === "canceled"
    )
    const active = runs.filter(
        (run) => run.status === "running" || run.status === "queued"
    )
    const done = runs.filter((run) => run.status === "succeeded")
    if (runs.length === 0) {
        return (
            <p className="px-4 py-6 text-pretty text-muted-foreground text-sm">
                No background work yet. When someone signs up, the run that
                tells your team appears here, and moves as it runs.
            </p>
        )
    }
    return (
        <div className="pb-4">
            <RunGroup
                title="Needs attention"
                runs={attention}
                chosen={chosen}
                now={now}
            />
            <RunGroup
                title="Running"
                runs={active}
                chosen={chosen}
                now={now}
                empty="Nothing running right now."
            />
            <RunGroup title="Done" runs={done} chosen={chosen} now={now} />
        </div>
    )
}

function RunGroup({
    title,
    runs,
    chosen,
    now,
    empty
}: {
    title: string
    runs: RunSummary[]
    chosen: string | undefined
    now: Date
    empty?: string
}) {
    if (runs.length === 0 && empty === undefined) {
        return null
    }
    return (
        <section aria-label={title} className="px-2 pt-4">
            <h2 className="px-2 pb-1.5 font-medium text-muted-foreground text-xs">
                {title}
            </h2>
            {runs.length === 0 ? (
                <p className="px-2 py-2 text-muted-foreground text-sm">
                    {empty}
                </p>
            ) : (
                <ul className="flex flex-col gap-0.5">
                    {runs.map((run) => (
                        <li key={run.id}>
                            <Link
                                to="/admin/workflows"
                                search={{ run: run.id }}
                                aria-current={
                                    chosen === run.id ? "true" : undefined
                                }
                                className="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-x-3 rounded-md px-2 py-2 transition-colors hover:bg-background focus-visible:outline-2 focus-visible:outline-ring aria-[current=true]:bg-background aria-[current=true]:shadow-xs aria-[current=true]:ring-1 aria-[current=true]:ring-border"
                            >
                                <Stop state={runStop(run.status)} />
                                <span className="flex min-w-0 flex-col">
                                    <span className="truncate text-sm">
                                        {run.title}
                                    </span>
                                    <span className="truncate font-mono text-muted-foreground text-xs">
                                        {run.workflow}
                                    </span>
                                </span>
                                <span
                                    className="text-muted-foreground text-xs tabular-nums"
                                    title={moment(run.created_at)}
                                >
                                    {since(run.created_at, now)}
                                </span>
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    )
}

/** One run: where it is, its steps, what it was started with. */
export function RunDetailPane({ id }: { id: string }) {
    const now = useNow(1000)
    const found = useQuery(runQuery(id))
    const retry = useMutation(retryRun)
    const session = useSession()
    const may_retry =
        session.status === "logged-in" &&
        allows(session.permissions, "workflows", "write")

    if (found.isPending) {
        return (
            <div
                aria-hidden
                className="mx-auto flex max-w-3xl flex-col gap-4 px-5 py-8 sm:px-10"
            >
                <div className="h-8 w-2/3 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
                <div className="h-48 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
            </div>
        )
    } else if (found.isError) {
        const failure = failureOf(found.error)
        return (
            <div className="mx-auto flex max-w-3xl flex-col gap-4 px-5 py-8 sm:px-10">
                <BackToList to="/admin/workflows">Workflows</BackToList>
                {failure.reason === "not-found" ? (
                    <p className="text-muted-foreground text-sm">
                        There's no run with this id.
                    </p>
                ) : (
                    <CouldNotLoad
                        what="This run"
                        onRetry={() => found.refetch()}
                    />
                )}
            </div>
        )
    }

    const run = found.data
    const stopped = run.status === "failed" || run.status === "canceled"
    return (
        <article className="mx-auto flex max-w-3xl flex-col gap-8 px-5 py-6 sm:px-10 sm:py-8">
            <BackToList to="/admin/workflows">Workflows</BackToList>
            <header className="flex flex-col gap-3">
                <h1 className="text-balance font-heading font-semibold text-2xl tracking-tight">
                    {run.title}
                </h1>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                    <RunStatusMark status={run.status} />
                    <span
                        className="text-muted-foreground tabular-nums"
                        title={moment(run.created_at)}
                    >
                        Started {since(run.created_at, now)}
                    </span>
                    {run.completed_at !== null && (
                        <span className="text-muted-foreground tabular-nums">
                            Took {took(run.created_at, run.completed_at)}
                        </span>
                    )}
                    <RunLine run={run} />
                </div>
                {stopped && (
                    <div className="flex flex-col gap-3 rounded-lg bg-destructive/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-pretty text-destructive text-sm">
                            {run.status === "failed"
                                ? `It stopped: ${run.error ?? "it failed without saying why"}.`
                                : "It was canceled before it finished."}{" "}
                            {may_retry
                                ? "Trying again starts from where it stopped, keeping what its finished steps returned."
                                : "Your role can see the workflows but not run one again."}
                        </p>
                        {may_retry && (
                            <Button
                                variant="outline"
                                disabled={retry.isPending}
                                onClick={() => retry.mutate({ id: run.id })}
                                className="h-9 shrink-0 px-3"
                            >
                                <RotateCcw aria-hidden />
                                {retry.isPending ? "Starting…" : "Try again"}
                            </Button>
                        )}
                    </div>
                )}
                {retry.error !== null && (
                    <p role="alert" className="text-destructive text-sm">
                        It didn't start again: {failureOf(retry.error).message}.
                    </p>
                )}
            </header>

            <section className="flex flex-col gap-4">
                <h2 className={sectionHeading}>Steps</h2>
                <StepRail run={run} />
            </section>

            <section className="grid gap-6 sm:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-2">
                    <h2 className="font-medium text-sm">Started with</h2>
                    <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2.5 font-mono text-xs">
                        {run.input}
                    </pre>
                    {run.output !== null && run.status === "succeeded" && (
                        <>
                            <h2 className="pt-2 font-medium text-sm">
                                Answered
                            </h2>
                            <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2.5 font-mono text-xs">
                                {run.output}
                            </pre>
                        </>
                    )}
                </div>
                <dl className="flex flex-col gap-2 text-sm">
                    <div className="flex justify-between gap-4">
                        <dt className="text-muted-foreground">Workflow</dt>
                        <dd className="truncate font-mono text-xs">
                            {run.workflow}
                        </dd>
                    </div>
                    <div className="flex justify-between gap-4">
                        <dt className="shrink-0 text-muted-foreground">Run</dt>
                        <dd
                            className="truncate font-mono text-xs"
                            title={run.id}
                        >
                            {run.id}
                        </dd>
                    </div>
                    <div className="flex justify-between gap-4">
                        <dt className="text-muted-foreground">Started</dt>
                        <dd className="tabular-nums">
                            {moment(run.created_at)}
                        </dd>
                    </div>
                    {run.completed_at !== null && (
                        <div className="flex justify-between gap-4">
                            <dt className="text-muted-foreground">Finished</dt>
                            <dd className="tabular-nums">
                                {moment(run.completed_at)}
                            </dd>
                        </div>
                    )}
                </dl>
            </section>
        </article>
    )
}
