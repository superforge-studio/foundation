# Jobs

A job is a change to the app's data that someone starts on purpose:
cleaning up old rows, fixing a batch of contacts, filling in a new column.
**Its code is in the codebase**, reviewed and deployed like anything else,
and it runs as a workflow (`backend/workflows/`), in batches, picking up
where it stopped if the server restarts. Nothing changes data any other
way: never a script run against production from a laptop, and never code
sent to the server to run. Claude reads customers' messages, so a server
that ran whatever code it was handed would run whatever a message told
Claude to send.

## Starting one

| Route                  | What it does                                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| `GET /api/jobs`        | Every job: its name, what it does, and what it takes, as JSON Schema                                        |
| `POST /api/jobs/:name` | `{ input }`: the dry run, which answers `{ dry_run: true, plan: { summary, changes } }` and changes nothing |
| `POST /api/jobs/:name` | `{ input, dry_run: false }`: starts it, 202 with `{ run_id }`                                               |

A request is a dry run unless it says `dry_run: false`. Only a role that
may read the `jobs` area lists them, and only one that may write it plans
or starts one (`permitted("jobs")`). Claude calls them through the MCP's
`call_api` as the person who let it in, and since both are `POST`s, it
needs to have been allowed to act, and their role to write jobs. A run
is a workflow's run like any other, listed at `GET /api/workflows/runs`
and read at `GET /api/workflows/runs/:run_id`.

## Writing one

A feature defines its jobs in its own `jobs.ts` with `defineJob`
(`define.ts`), and lists them in `app.ts`'s `APP_JOBS`, this app's own,
which `index.ts`'s `JOBS` takes after the template's, and which also
registers each one's workflow (`backend/workflows/index.ts`):

- **`name`**, in the route: never rename one that has shipped, since its
  runs are recorded under it (its workflow is `job-<name>`).
- **`description`**, for the person or Claude choosing it, saying what it
  takes.
- **`input`**, a zod schema, checked before anything runs.
- **`plan`**, the dry run: it reads, never writes, and answers what the job
  would change, in a sentence and a count.
- **`run`**, the workflow's body: a step per batch, through operations,
  every step safe to run again (`backend/workflows/README.md`, "Steps").

The template's example is `prune-sessions` (`backend/auth/jobs.ts`), which
deletes the sessions that have run out, 500 at a time.
