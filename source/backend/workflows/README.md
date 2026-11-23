# Workflows

Background work, outside any request, that picks up where it stopped when
the process does: sending something with retries, a job that runs for
minutes, anything a route shouldn't make a person wait on. It runs on
**DBOS**, a library, in this same Node process, with its checkpoints in
the app's own Postgres, in the `dbos` schema. There's no second service
and no other database to run.

## Writing one

A feature's workflows live in its folder's `workflows.ts`:

```typescript
// backend/contacts/workflows.ts
export const notifyOwner = defineWorkflow({
    name: "notify-owner",
    input: z.object({ submission_id: z.string() }),
    run: async ({ submission_id }, context) => {
        const submission = await context.step("read", () =>
            findSubmission(context.database, submission_id)
        )
        await context.step("send", () => sendNotice(submission))
    }
})
```

Then:

1. **List it in `index.ts`'s `WORKFLOWS`.** DBOS has to know every
   workflow before it launches, and a workflow left out never runs:
   starting one throws.
2. **Start it from a route** with
   `await context.var.workflows.start(notifyOwner, input, { id })`, which
   puts a run on its queue and answers its id. A route test's
   `testApi()` records the starts instead of running them, in `started`.
3. **Name the run after what it's for** when it should happen once
   (`notify-${submission_id}`): starting a run under an id that's taken
   finds the one there, finished or not, so a route that's called twice
   starts it once.

### Steps

**Everything a workflow does goes through `context.step(name, callback)`**,
and every step calls operations, the same functions a route calls
(`workbench/writing-code.md`, "Headless"). Once a step has returned, a run
that starts again gets back what it returned, by name, instead of running
it again. So:

- **Every step must be safe to run twice.** A run cut off mid-step (a
  deploy, a crash) runs that step again in the next process, and one that
  throws is tried again: after 10 seconds, then twice as long each time, 8
  attempts in all (`STEP` in `define.ts`), about 21 minutes before the run
  fails. An insert keyed by the run's id, an upsert, or a send with an
  idempotency key; never "add one".
- **Between steps, the body only steers on what steps returned.** Read the
  clock, a random number or the database inside a step, never beside one:
  a run that starts again replays the body, and has to take the same path.
- **A step returns little**, what the rest of the run steers on, as plain
  JSON: an id, a count, a status. What it reads or makes is saved inside
  the step, not returned, since each result is a row in DBOS's tables.
- **Each step in a run has a name of its own.** A step in a loop names its
  turn: `send-${index}`.

### Changing a workflow

A shipped workflow's name, its input, and its steps' names, order and
results are **a contract with the runs already in flight**: a run that
restarts on new code is handed each finished step's stored result, in
order, and DBOS refuses one whose step names don't match (it fails with
`DBOSUnexpectedStepError`). So, while a run of it may be in flight:

- **Its input only grows**, with optional fields. Each run's input is
  checked against the workflow's schema as it starts, and one that doesn't
  fit fails, logged.
- **Its steps keep their names, order and result shapes.** A new step
  goes after the last, or behind `DBOS.patch()`, which `enablePatching`
  turns on, for a run started before it to skip.
- **Anything bigger is a new workflow** with a new name. The old one stays
  in `WORKFLOWS` until its runs have finished. Once it's gone, its runs
  stay on the Workflows screen under its name.

Never delete DBOS's rows by hand, nor write to its tables.

## How it runs

- **`startWorkflows()`** (`engine.ts`) registers every workflow, takes the
  gate, launches DBOS, which recovers whatever runs were left unfinished,
  and opens the queues (`queues.ts`). The Node server calls it once it's
  listening (`source/node.ts`, through `source/server.ts`), and a dev
  server as it first loads `server.ts`. Never the build's prerender, which
  loads `server.ts` too, nor the tests, but for `tests/engine.test.ts`. A
  start that fails is logged and tried again a minute later.
- **`stopWorkflows()`** shuts DBOS down with its runs left where they are,
  and lets go of the gate. The Node server calls it on SIGTERM, before it
  finishes its requests.
- **Once a process.** What a process holds of its workflows is on
  `globalThis` (`process.ts`), since Vite's dev server evaluates a changed
  module again, and DBOS refuses a workflow registered twice, or after it
  has launched. The function DBOS registered runs whichever body was
  evaluated last, so a dev server picks up a change to a workflow's body.
  A new workflow needs the dev server started again.
- **The gate.** Each process takes a session advisory lock,
  `pg_advisory_lock(1689, 0)`, on a connection of its own before DBOS
  launches, and holds it for its life. DBOS recovers every unfinished run
  as it launches, even one another live process is running, and Railway
  runs the old and new deployments side by side until the new one is
  healthy: without the gate, both would run the same step. With it, a new
  deployment waits, answering `/api/health`, until Railway has sent the old
  one SIGTERM; that one stops its workflows, and the new one launches
  within a moment and carries on what was left. Losing the gate's
  connection loses the lock, so the process stops its workflows and starts
  them again behind the gate. **One process runs the workflows at a time**,
  so a second replica would only answer requests.
- **Before it launches**, a process puts the runs it starts on their
  queues through a DBOS client, for whichever process runs them.
- **Every run goes on a queue**, `background` unless its workflow names
  another, which meters how many run at once. A workflow that needs its own
  limits gets a queue of its own in `queues.ts`.
- **DBOS's tables** are made and migrated by `pnpm database:migrate`
  (`DBOS.migrate`, `source/database/migrate.ts`) before each deploy, so
  they're there before any process starts, and a DBOS upgrade's migrations
  run while the version before still serves, like ours. DBOS is pinned to
  an exact version for that reason: read its release notes before raising
  it.
- **Finished runs are kept for good**, with their steps, inputs and
  outputs, so the Workflows screen opens one from months ago as it does
  one from today. DBOS never deletes a run on its own, and its tables gain
  a row with every step, which steps that return little keep small. A
  copy whose runs grow too many for its database sets `KEEP_FINISHED_FOR`
  (`engine.ts`) to a duration, like `90 * DAY`, and the runs that finished
  longer ago than that are then pruned about once an hour
  (`pruneFinishedRuns`).
- **Connections**, of the 500 Railway's Postgres allows: the app's pool
  keeps 10, DBOS's 10, its client 2 (only until DBOS has launched there),
  and the gate 1. So a process holds at most 23, and the two running while
  a deploy goes out 46.

## Reading runs

The dashboard's Workflows screen shows every run as it runs, with its
steps, what went wrong where one failed, and a way to run it again
(`routes.ts`, under `/api/workflows`, for internal people only). It reads
them through `context.var.workflows`, which asks DBOS's own functions,
never its tables, which are DBOS's to change (`engine.ts`):

- **`runs()`**, the latest hundred, newest first, through
  `listWorkflows`, with each one's input and, for a failed one, its error.
  An older run isn't listed, but still opens by its id.
- **`run(id)`**, one with what it returned and each step it has
  finished, through `listWorkflowSteps`. DBOS records a step once it has
  returned, so a run that's working shows the steps before the one it's
  on.
- **`retry(id)`**, a failed or canceled run again, under the same id,
  through `rewindWorkflow`: from the step it failed at, or just after the
  last it finished, so the steps before keep what they returned and don't
  run again. Fix whatever made it fail first.

**A run's title** is its workflow's `title`, from its input, like "Tell the
team about ada@example.com", or the workflow's name without one; give a
new workflow a title, since it's what the screen lists.
`runs.ts` turns what DBOS says into what the screen shows: a status in
words (`queued`, `running`, `succeeded`, `failed`, `canceled`), times as
ISO strings, and inputs and outputs as JSON text.

**On Railway, each run is a trace too**, while the server traces
(`source/tracing.ts`): DBOS's own spans, `tracingEnabled` in `engine.ts`,
one named for the workflow, with one for each step inside it, named for
the step, and each step's queries and calls out inside that, beside the
queries DBOS checkpoints the step with. Each carries the run's id as
`dbos.operation.workflow_id`, so `list-traces` on the Railway MCP finds a
run's trace with `@dbos.operation.workflow_id:<id>`, and what a step logs
is on its span. A run is a trace of its own, not part of the request that
started it, since a queue runs it later; that request's span has the log
of the start, with the id (workbench/writing-code.md, "Logging and
tracing").

## The sample

**`tell-team-of-sign-up`** (`backend/users/workflows.ts`) is the
template's example: a sign-in that makes someone new starts it, named for
them so it runs once (`backend/auth/routes.ts`), and its three steps read
them, find the business's own people, and send the notice, which goes to
the logs until Superforge Infra can send email. `pnpm database:seed` puts
real runs of it on the queue, for a dev server to run, rather than writing
DBOS's rows. A copy keeps it, or deletes it with its line in `index.ts`
and the start in `backend/auth/routes.ts`.

## When not to use one

**Something short that's just due at a time** (a reminder, a poll) is a
timestamp in Postgres that a runner checks, not a workflow: a workflow
would only add rows to DBOS's tables for each one, and one a deploy cuts
off is still due, so the next process runs it.

### Runners

**A runner** (`runners.ts`) is what checks: a name, how often, and a
function its turn runs, handed the process's database, bucket and
workflows. Listed in `index.ts`'s `RUNNERS`, each runs on its timer while
this process runs the workflows, behind the gate, so one process at a time
does, and stops before DBOS shuts down. A turn never overlaps the one
before it, and one that throws is logged and the runner goes on. Its turn
is short: it finds what's due and does it, or starts a run for each,
named for what it's for so a turn that finds it again starts it once. A
runner a minute or more apart traces each turn, as `runner <name>`; one
every few seconds doesn't, since most of its turns find nothing, and what
it starts is traced as its run.

## Testing

- **A route that starts one** is tested with `testApi()`
  (`backend/tests/support/api.ts`), whose `started` lists each run the
  route started, with its input and id. A route that reads runs reads
  what's in its `runs`, which a test can add to, like a failed run with its
  steps, and `retried` lists each run it ran again.
- **What a step does** is an operation's, tested as one, on a database of
  the test's own.
- **The workflow itself**, when the order of its steps matters, runs on
  DBOS as `tests/engine.test.ts` runs its own: a database of its own copied
  from the run's template, `startWorkflows()` with the workflow in
  `workflows`, and `stopWorkflows()` after. DBOS is one per process, so
  those tests run one after another in their file.
