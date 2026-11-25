# Writing code

Read this before writing or editing any code here. `CLAUDE.md`
owns the universal layer (architecture index, README rules, the commit
gate); this doc owns everything about producing code: where it goes, the
data and its migrations, local development, the conventions tooling can't
enforce, and the verification loop.

## Where code lives

Everything runs in one Node server on Railway (`source/node.ts`).
`source/server.ts` decides who answers a request:

| Path       | Handled by                       | Rendered                                     |
| ---------- | -------------------------------- | -------------------------------------------- |
| `/api/*`   | Hono (`source/backend/index.ts`) | —                                            |
| Every page | TanStack Start                   | Prerendered at build, served as static files |
| Not a page | TanStack Start                   | On request: the not-found page               |

Before any of them, it asks the app's own answers (`appAnswer`,
`source/app.ts`), for whatever they claim, like a path under `/api` on a
host of the app's own; what they leave goes on as the table says.

A page is only ever fetched: anything but a `GET` or a `HEAD` sent where a
page would be, like a webhook given the site's address, is refused with a
405 before it reaches Start, which would draw the page and answer 200.
Every request nothing answers, and every one that fails, is logged
(`source/backend/misses/`; "Logging and tracing", below).

Static files, the prerendered pages among them, are served **before**
`source/server.ts` runs. A page never reaches it, so don't put
request-time logic (auth, redirects, headers) in front of one and expect it
to run. A page that needs to change per request is client-rendered (`ssr:
false` on its route) and left out of the prerender.

### Headless

**Every database read and write goes through `backend/`'s operations, and
routes under `/api` are how people and agents reach them.** It's a rule,
not a preference. There are three ways into the data, and if each read and
wrote it its own way, their checks would drift apart:

```text
 Website (pages)          Claude, at /admin/mcp      Workflows (DBOS)
       │ the typed client       │ HTTP, with a token         │
       └───────────────► routes under /api                   │
                               ▼                             ▼
             operations: plain functions, the only code that touches the database
                               ▼
                  Postgres: public · auth · internal · dbos
```

- **Only `backend/` touches the database, and inside it only
  operations do**: plain functions that take the database and their
  input and answer what happened, named for what they do
  (`users/sync.ts`, `auth/sessions.ts`). A route checks what came in,
  calls an operation, and answers; a workflow's step calls one. Neither
  runs a query of its own.
- **The website reaches data only over HTTP**, through the API's typed
  client (`source/backend/client.ts`) with the visitor's session. Pages,
  route loaders and TanStack server functions never touch the database,
  and nothing in `frontend/` imports from `database/`. A page that needs
  data asks the API, through TanStack Query.
- **`database/` is imported only by `backend/`**, and by its own scripts
  and tests.
- **Claude is one of the ways in.** It connects to the app's MCP
  (`backend/mcp/`), logged in as one of the team with a token Infra
  signs, which the login middleware takes in a cookie's place
  (`backend/auth/agents.ts`), and its tools call the routes under `/api`
  in this process. So every route is a tool, with its checks, Claude
  does no more than its person's role lets them, and a route that changes
  who can log in takes `inBrowser`, so no token can.
- **So is a script with an API token.** What can't log in through a
  browser as Claude does, like a scheduled job or another platform's
  agent, calls `/api` with `Authorization: Bearer api_…`, a token one of
  the team made on their account page, acting as them with the scopes
  they gave it (`backend/auth/api-tokens.ts`), until they revoke it. The
  middleware takes it as it takes Claude's, and `inBrowser` refuses it
  the same way.
- **The system is the code.** A workflow, a runner, a job's run or the
  seed calls operations directly, never a route, so it never passes the
  login middleware and needs no permission: it's code in the repository,
  changed only by a commit. There's no token for it, so none can leak.
  Everyone who reaches the data from outside, a person, Claude or a
  script, does it through a route, as someone on the team, with what
  their role allows ([The team and what each role may
do](#the-team-and-what-each-role-may-do)).
- **A feature is a route before it's a screen.** Anything a person or an
  agent can do is a route, with its checks, so a script or an agent can do
  through the same route what a person does on the site. A workflow, which
  runs inside the server, calls the operation behind it directly, not the
  route over HTTP.

One layer of operations means one place for the checks, the authorization
and the tests, whichever way in.

### Choosing where new code goes

`source/` has four areas, and the line between the first two is the one that
matters:

- **`frontend/`** — the website: file-based routes, components, queries,
  the router and styles. TanStack Start renders it on the server too (the
  prerender), so "frontend" means _the site_, not "runs only in the
  browser".
- **`backend/`** — the Hono API under `/api`, a folder per feature, the
  workflows, and the typed client the frontend calls the API with
  (`client.ts`). **`frontend/` imports nothing from `backend/` except
  `client.ts` and types** (`import type`). `client.ts` only takes the API's
  types, so no server code reaches the browser bundle; importing anything
  else from `backend/` would ship it.

  ```text
  backend/
    index.ts        apiWith(): mounts each feature's routes, and puts the
                    database, the bucket and the workflows on context.var
    app.ts          this app's own: its features' routes, and what they
                    see on context.var ("Yours and the template's")
    client.ts       the typed client the website calls the API with
    context.ts      what every route sees on its context
    failures.ts     the one failure shape: failure(), validated()
    workflows/      DBOS, for background work (its README has the rules)
    infra/          Superforge Infra, the one wrapper for calling it
    auth/           logging in through Infra, the sessions, loggedIn and
                    permitted, and the team and its roles (access.ts)
    <feature>/      one folder per feature, like health/, account/ and
                    users/
      routes.ts     Hono: check the input, call an operation, answer
      check.ts      its operations, a file per verb (create.ts, find.ts)
      workflows.ts  its workflows, if it has background work
      tests/
  ```
- **`database/`** — the Postgres database: its Drizzle schema, `connect()`
  and `appDatabase()`, the migrations ([Data](#data)) and this checkout's
  own Postgres ([Local development](#local-development)). Server-only: used
  by `backend/`, never by `frontend/`.
- **`utilities/`** — what both sides share. Nothing here may import from
  the other three. It has three folders, and a file that fits none of them
  sits at the top, named for what it's about, like `webhooks.ts`:
  - **`primitives/`**, what knows nothing of the app, and could be copied
    into another one unchanged: `durations.ts`'s `MINUTE` and `WEEK`. Nothing here imports even from the rest of `utilities/`.
  - **`schemas/`**, the zod schemas both sides check with, a file per
    feature, so a form and the route it posts to check with the same one:
    `failures.ts`, the shape every failure takes. A schema only one side
    uses stays on that side.

`source/server.ts` and `source/node.ts` sit above them all. TanStack's
`router.tsx` and generated `routeTree.gen.ts` live in `frontend/`
(configured in `vite.config.ts`).

### Yours and the template's

**A file has one owner: the template, or this app.** An update from the
template (`workbench/updating.md`) changes the template's files, so
anything of the business's written into one meets the next update as a
conflict. Most of what an app adds is a file of its own already: a
feature's folder in `backend/`, a page's route, a component, a query. The
exception is a list the template keeps that an app adds to, like the
tables or the routes. Each of those has a file of the app's beside it,
named `app.ts`, which the template's reads. The template made each once,
empty, and no update changes it:

| The app's own                             | go in                                  | beside the template's    |
| ----------------------------------------- | -------------------------------------- | ------------------------ |
| Tables                                    | `source/database/schema/app.ts`        | `schema/foundation.ts`   |
| Seeders, and tables that get none         | `source/database/seed/app.ts`          | `seed/seed.ts`           |
| Kinds of file in the bucket               | `source/database/storage/app.ts`       | `storage/files.ts`       |
| Routes, and what they see on `context`    | `source/backend/app.ts`                | `index.ts`, `context.ts` |
| Workflows and runners                     | `source/backend/workflows/app.ts`      | `workflows/index.ts`     |
| Jobs                                      | `source/backend/jobs/app.ts`           | `jobs/index.ts`          |
| Whoever logs in besides the team          | `source/backend/auth/app.ts`           | `auth/others.ts`         |
| Checks before the app says it's healthy   | `source/backend/health/app.ts`         | `health/routes.ts`       |
| Areas of the app                          | `source/utilities/permissions/app.ts`  | `permissions/index.ts`   |
| Answers of its own, asked before the rest | `source/app.ts`                        | `source/server.ts`       |
| Stand-ins a test gets for the app's own   | `source/backend/tests/support/app.ts`  | `tests/support/api.ts`   |
| The upgrade test's samples of its columns | `source/database/tests/support/app.ts` | `tests/support/fill.ts`  |

**Never add the app's own to a file the template owns.** When the
template has no place for what the app needs, change the template's file
and say so in the PR, so the conflict the next update brings there is
expected. What the business is meant to make its own stays its own through
an update: the pages and their look, the team and its roles (`ACCESS`),
`.railway/railway.ts`, `PRODUCT.md` and `DESIGN.md`.

- **A new page** → a route file under `source/frontend/routes/`. Link to
  it from somewhere reachable from `/`: the prerenderer crawls links, and an
  unlinked page is not prerendered. A page that throws during the crawl
  fails `pnpm build`.
- **A new feature** → a folder in `source/backend/` named for it
  (`contacts/`), with its routes in `routes.ts`, a Hono app of its own
  mounted in `app.ts` (`appRoutes`), and its operations beside them, a
  file per verb
  (`create.ts`, `find.ts`). `health/` is the smallest example. Never a
  TanStack server function ([Headless](#headless)): Hono routes are plain
  HTTP, so a webhook, a script or an agent can reach them too.
- **A new API endpoint** → a route in its feature's `routes.ts`, which
  checks what comes in with `validated(target, schema)`
  (`backend/failures.ts`), calls an operation, and answers. It reads the
  database from `context.var.database`, never `appDatabase()` directly, so
  a test can hand it its own, and likewise `context.var.storage` and
  `context.var.workflows`. The browser calls it through the typed client
  in `source/backend/client.ts`, inside a TanStack Query `queryOptions` or
  `mutationOptions` in `source/frontend/queries/`, a file per area of the
  API, like `users.ts`.
- **An operation** → a plain function in its feature's folder that takes
  the database (a `Database`, so it runs inside a transaction too) and its
  input, and answers an `OperationResult` when it can fail in a way its
  caller handles ([Tagged results](#tagged-results-for-expected-failures)). It's the only code that queries the database, so the
  checks a write needs beyond its input's shape (that the row exists, that
  the user may) live here, where every way in gets them.
- **A call to an outside service** (an email provider, a payments API) →
  one wrapper for that service, in a folder of its own under `backend/`
  named for it, which every route and step calls; never a bare `fetch` in
  a route. The wrapper owns its credential, its timeouts, its retries and
  its pacing, parses what the service sends with zod, logs each call's
  outcome, and answers an `OperationResult` for the failures its callers
  handle. It goes on `context` for every route (`AppVariables` and
  `appVariables`, `backend/app.ts`), and a test hands its callers a fake of
  it (`backend/tests/support/app.ts`). Superforge Infra's is
  `backend/infra/`, on `context.var.infra`, with a stand-in the tests and
  a dev server without a key use.
- **A table or a column** → the app's own tables are in
  `source/database/schema/app.ts`, and the template's in
  `schema/foundation.ts`, both exported from `source/database/schema.ts`,
  which the code imports them from; with a migration from
  `pnpm database:generate` ([Migrations](#migrations)).
- **A new React component** → a folder of `source/frontend/components/`
  by what it's for: `primitives/` for shadcn's (`pnpm dlx shadcn@4 add
  <name>`, which `components.json` sends there), `states/` for what a
  screen shows while it's empty, loading or lost (`not-found.tsx`),
  `site/` for the public pages' and `dashboard/` for the admin's screens.
- **A screen behind login** → a route under
  `source/frontend/routes/admin/`, drawn in the browser (`ssr: false` on
  `admin/route.tsx`) and left out of the prerender (the `filter` in
  `vite.config.ts`), since it changes per visitor, which knows who's
  logged in, and what their role lets them do, from `useSession()`
  (`frontend/queries/auth.ts`). It sits in the admin's frame
  (`components/dashboard/shell.tsx`): a list beside the one chosen from
  it, chosen by an id in the address (`?run=`, `?person=`), so Back and a
  shared link keep it. It gets a place in the bar's switch (`SECTIONS`),
  with the area it shows, so someone whose role can't read that area
  doesn't see it, and draws `NotPermitted` for them if they open it
  anyway. An address under `/admin` that's no page is answered in the
  same frame (`AdminNotFound`), and anywhere else by the site's own
  (`components/states/not-found.tsx`). Public pages stay prerendered, like
  `/login` itself.
- **A route that needs the user** → `permitted("<area>")` before its
  handler (`backend/auth/logged-in.ts`) for what's the business's, the
  area it's in, which answers 401 `logged-out` without a live session, 403
  `not-permitted` to someone whose role doesn't reach it, saying the area
  and level it needed, and puts the user on `context.var.user` and what
  they may do on `context.var.permissions`; `loggedIn` for what's anyone
  on the team's own, like their account; `maybeLoggedIn` for a route a
  visitor may call too, with the user or null. Nothing else reads the
  session's cookie or `auth.sessions`, so who's logged in, and who may do
  what, is decided in one place, whatever a page shows. A test fails any
  route under `/api` that says none of these and isn't one of the few
  anyone may call (`backend/tests/routes.test.ts`, `ANYONE`, and the
  app's own in `tests/support/app.ts`, `APP_ANYONE`).
- **Someone besides the team who logs in**, like a customer with a page
  of their own → a second kind of person, given a way in through
  `OTHERS` (`backend/auth/app.ts`, on `auth/others.ts`, which says what
  it's asked), from a feature of its own that keeps them, with a table of
  its own for their sessions and a check of its own for their routes.
  The team's login, `auth.sessions`, `loggedIn` and `permitted` stay the
  team's alone.
- **A route anyone may call that writes**, like a form's or a booking's
  → `countAttempt` before anything else (`backend/rate-limits/count.ts`),
  by what it limits and `networkKey(ip)`, a hash of the caller's network,
  and 429 `too-many` with a `Retry-After` once it's past the most it
  allows, so a script can't fill the database with junk. It's counted in
  `internal.rate_limits`, so every server and every deploy count together.
- **A file the team uploads, or one the app hands someone** → Your files,
  under `/api/files` (`backend/files/`), whose rows name it and whose
  bytes are in the bucket's `files` folder; a file the code itself writes
  and reads, like an invoice it makes, is a kind of its own instead (the
  bucket, under [Data](#data)).
- **Something that runs in the background** → a workflow, in its
  feature's `workflows.ts`, listed in `backend/workflows/app.ts`, and
  queued in the transaction of the write it's for, by name with
  `queueWorkflow` or on an event with `queueEvent`
  (`backend/workflows/queue.ts`), or started from a route through
  `context.var.workflows` (`source/backend/workflows/README.md` has the
  rules every step follows, and "Queueing a run with a write" what goes in
  the transaction and what goes in a workflow). Work at set times, like a
  nightly digest, is a workflow with a cron `schedule`, which DBOS fires.
  Something short that's just due at a time is a timestamp in Postgres
  that a runner checks, not a workflow. A second service in the Railway
  project (`.railway/railway.ts`), started from this same package with its
  own start command, or a cron service with a `cronSchedule`, only when
  something must deploy or scale on its own. Not a second package: one
  database means one package.
- **A webhook from another service** → a source in
  `backend/webhooks/sources.ts`'s `SOURCES`, posting to
  `/api/webhooks/<source>`, whose deliveries are kept as they came,
  checked, and turned into events for the workflows on them
  (`source/backend/webhooks/README.md`, "Adding a source"). Never a route
  of its own.
- **Content** lives where it's published: a page's copy in its route, and
  copy more than one page shares in `source/utilities/`.

### The team and what each role may do

**Only the team logs in, and the team is listed in code**: `internal_users`
in `ACCESS`, `source/backend/auth/access.ts`, each with a slug that never
changes, a first name, a last name, the address they log in with and
their role, an `owner` or a `member` (`TEAM_ROLES`), a member when it's
left out. They're the only users there are, and nobody else logs in: an
address the list doesn't have is refused before Infra is asked to email
it. It's code, not a Railway variable or a screen, so a dev server logs in
the way production does, and the team only changes with a commit.

- **The database follows the list.** The server's start, and each login,
  make each listed person's row follow how they're listed
  (`backend/users/sync.ts`), found by their slug, so a new address
  changes their row rather than making another, and deactivate anyone
  taken off it (`deactivated_at`), ending their sessions while their row,
  and what they did, stays. Listing them again with the same slug brings
  the same row back. The login middleware counts someone only while the
  list has them, by their slug, whatever the database says, so taking
  them off logs them out at their next request.
- **What each role may do is a level in each area of the app**:
  `roles` in the same `ACCESS`, and the areas in
  `source/utilities/permissions/` (`AREAS`: the template's in `index.ts`,
  the app's own in `app.ts`), which both sides read. A level is `none`, `read` or `write`, each including
  the one before. A role is given `"everything"`, every area there is and
  every one added later, as the `owner` is, or a level for each area it
  may use, the rest being `none`, as the `member` is. An area is what a
  person would grant, roughly a screen of the admin, never a table: one
  action writes many tables, and a renamed table mustn't change who may
  do what.
- **Every route of the business's names its area**, with
  `permitted("<area>")`: a `GET` needs `read`, and anything else `write`,
  unless the route says (`permitted("orders", "read")` for a `POST` that
  only reads). One that's someone's own, like their account, takes
  `loggedIn`. That's the only check: not Postgres's row-level security,
  since every read and write already goes through `backend/`'s
  operations behind a route ([Headless](#headless)), and one app holds
  one business, so there's no tenant to wall off. A rule about which
  rows, like a technician who sees only their own appointments, goes in
  the operation, which takes the person and filters by them.
- **A token never does more than its person.** Claude's token and an API
  token act as the person who made them, with what their role allows,
  narrowed by what they gave the token: `read` reads every area their
  role reads, and `act` changes what their role may change. A token can't
  be given more than its person has, and what only a browser may do
  (`inBrowser`) no token does.
- **The admin follows the same levels.** `/api/auth/session` answers the
  person and their `permissions`, which `useSession()` hands every screen,
  and `allows(permissions, area, level)` (`utilities/permissions/`) is
  the check on both sides: the bar leaves out a section someone can't
  read, and a button that writes, like a run's Try again, shows only to
  a role that may write. Hiding it is a courtesy; the route is the guard.
- **A new area**, like `orders`, goes in `APP_AREAS`
  (`utilities/permissions/app.ts`), with what it covers, its routes name
  it, and each role in `roles` is given it: the `owner` has it already,
  and a `member` doesn't until it's given a level there. Its screen's
  section names it in `SECTIONS`.
- **A new role**, like `technician`, goes in `TEAM_ROLES`, with its
  areas in `roles` and its name on screen in `ROLE_NAMES`
  (`components/dashboard/permissions.tsx`); then someone is listed with it
  (`role: "technician"`). Nothing in the database changes.
- **In a test**, routes read the team from `context.var.access`, and a
  test hands its own (`testApi({ access })`), with its own `roles` when it
  tests one, or logs someone in with `logInAs(api, email, role)`, which
  lists them first, an `owner` unless it says.

### How a route fails

**Every route fails in one shape**, so the site, scripts and agents read a
failure the same way, whatever route it came from
(`source/utilities/schemas/failures.ts`):

```json
{ "error": { "reason": "not-found", "message": "No such file" } }
```

`reason` is for a program to branch on, a kebab-case word or two that
never changes once a route answers with it, and `message` is for a person.
The status says what kind of failure it is: 400 for input that doesn't
fit, 401 for nobody logged in, 403 for someone who may not, 404 for what
isn't there, 409 for a conflict, 503 for a dependency that's down.

- **An expected failure** is answered with
  `failure(context, status, reason, message)` (`backend/failures.ts`),
  usually from the result an operation answered:
  `failure(context, 404, found.error, "No such file")`. The typed client
  knows each reason a route can answer.
- **Input that doesn't fit** is answered by `validated()` itself: 400,
  `invalid`, and `issues`, what didn't fit, field by field. A body that
  isn't JSON at all is 400 `invalid` too, without `issues`.
- **Another origin's request** that would change something (any method
  but `GET`, `HEAD` and `OPTIONS`) is 403 `forbidden` (`refuseOtherSites`
  in `index.ts`) when the browser says where it came from: an `Origin`
  that isn't this host, or a `Sec-Fetch-Site` of `cross-site` or
  `same-site`, like a sibling subdomain's page, whatever its body. A
  script or curl sends neither, so it gets through.
- **A body over a megabyte** is 413 `too-large` (`API_BODY_LIMIT` in
  `index.ts`), before it's read; a route that takes more sets its own
  limit after its checks, as a dev server's upload does.
- **A path no route answers** is 404 `not-found`, and **a route that
  throws** is 500 `unexpected`, logged (`index.ts` mounts both handlers).
  Throwing is for bugs, never for a failure a caller handles.
- **A page reads a failure** with `readFailure(response)`
  (`frontend/queries/failures.ts`), inside its query, as `users.ts` does,
  which answers `unavailable` for an answer not in this shape, like
  Railway's own page while the server is down.

## Data

There's **one database, Postgres**, on Railway, queried with Drizzle
(`drizzle-orm/node-postgres`) from `source/database/`.

|                       | Postgres                                                                       |
| --------------------- | ------------------------------------------------------------------------------ |
| Holds                 | the users, the team, in `public`, and their sessions and API tokens, in `auth` |
| And                   | Your files, `files` and `file_folders`, and the site's analytics, in `public`  |
| And                   | the webhooks' deliveries and the rate limits, in `internal`                    |
| And                   | DBOS's, the workflows' runs and steps, in `dbos` (`backend/workflows/`)        |
| Schema                | `source/database/schema.ts`, from `schema/foundation.ts` and `schema/app.ts`   |
| New migration         | `pnpm database:generate`, into `source/database/migrations/`                   |
| Applied in production | `pnpm database:migrate`, Railway's pre-deploy command, before each deploy      |
| `pnpm dev` uses       | the checkout's own (`source/database/local/`), with the branch's migrations    |
| The tests use         | a database of each test's own, on the checkout's Postgres, in CI too           |
| Checked in CI by      | `pnpm database:check`, the tests from empty, and the PR's upgrade test         |
| Read by hand with     | `pnpm database:sql "<query>"`, or the database's Data tab on Railway           |
| Restored with         | point-in-time recovery, to any moment in about the last four weeks (below)     |

The conventions every table follows are in `schema.ts`'s header: named for
the thing itself (`files`), or for what it's about and then what its rows
are (`file_folders`), never repeating its Postgres schema (`auth.sessions`),
snake_case columns, uuids for our own rows, every timestamp a
`timestamptz` to the millisecond (`columns.ts`), compared against `now` and
`fromNow` from `time.ts`.

**A table's name starts with what it's about.** One that is the thing
itself is its plural (`users`, `files`); every other table is that thing's
name, then what its rows are, so a feature's tables sort together:
`file_folders`, and a business's own `vehicle_jobs` beside its `vehicles`.
The Postgres schema already says who sees it, so the name never repeats it
(`auth.sessions`).

**Every row of ours is keyed by a uuid that Postgres makes** (`id()` in
`columns.ts`, `gen_random_uuid()`), and a column that points at one is a
`uuid()`. An ID that comes in is checked with `z.uuid()`. A row people
need to read, say aloud or put on paper gets a field of its own for it,
like an invoice's number, rather than a shorter key.

**A column whose values are a fixed list is `text({ enum: LIST })` with a
check made from the same list, never a Postgres enum (`pgEnum`).** Drizzle
types the two the same in TypeScript, so a Postgres enum buys no type
safety, and the check is what Postgres enforces. A value added to a
Postgres enum can't be used in the transaction that adds it, and a deploy
applies every pending migration in one, so a migration that adds a value
and uses it fails the deploy; a value can't be taken out of one without
rebuilding the type and every column on it; and the upgrade test's sample
rows know a `text({ enum })`'s list, not a Postgres enum's.
`files.state` is the pattern: the list is a constant both sides import
(`FILE_STATES`, `utilities/schemas/files.ts`), and `pnpm database:generate`
writes the migration that changes the check when it changes.

- **A route hands its operations `context.var.database`**, and a
  workflow's step its `context.database`. `source/backend/index.ts` puts it
  there for every request: `appDatabase()`, the server's one pool,
  connected to `DATABASE_URL` (Railway sets it), or to the checkout's own
  database in a dev server, whatever `DATABASE_URL` says. A script makes its
  own with `connect(url)` and ends it with `.$client.end()`.
- **Statements that must land together go in one transaction**:
  `database.transaction(async (transaction) => …)`. Inside it, every query
  goes through `transaction`: one on `database` runs on another
  connection, outside it. A function that may run inside one takes the
  `Database` type, which a `transaction` is too. The work a write means
  goes in it too, queued (`queueWorkflow`, `queueEvent`), so a write never
  lands without its run, and no run starts for one that rolled back.
- **Index the column a foreign key or a join follows.** Postgres doesn't
  index a foreign key's column by itself, and a cascade from a parent then
  scans the child's table.
- **The server keeps 10 connections** (`connect()`'s pool), of the 500
  Railway's Postgres allows, and its workflows up to 13 more
  (`backend/workflows/engine.ts`). A query that holds one for long, or a
  loop that opens many, starves every request behind it.
- **Files go in the Storage bucket, not the database**, one kind of file
  to a folder, and only through that kind. Each kind is a getter on the
  `Storage` class, the template's in `source/database/storage/files.ts`,
  whose header has the first one's shape, and the app's own in
  `storage/app.ts`, named for its folder, which says what a file is
  filed under (a zod schema of its key, like `{ customer_id, invoice_id
  }`), where a key's file goes (`<customer id>/<invoice id>.pdf`), and
  what's in it: `json(schema)`, checked with zod as it's kept and as it's
  read back, `text(content_type)` or `bytes(content_type)`
  (`storage/kind.ts`), and how it shows on a screen of the bucket's
  folders (`shown`: its name, what it holds, and `locked`, with why, for
  files the code writes and depends on). Every kind is listed in
  `Storage.kinds`, which its test checks. An operation then calls
  `storage.invoices.put(key, body)`, with the `context.var.storage` its
  route or step handed it, `.get(key)` (null when
  there's no file) or `.delete(key)`, and never writes a path: a key that doesn't fit its kind, or a path with an
  empty, `.` or `..` part, throws before anything is kept. A file a
  browser fetches or sends goes straight between it and the bucket:
  `.presignGet(key, { seconds, download })` is a link that reads it, and
  `.presignPost(key, { seconds, max_bytes })` a form the browser posts it
  to. A dev server's folder can't sign either (`not-presignable`), so
  there the route serves it with `.open(key, range)`, a stream, or takes
  it and calls `.put`. `.head(key)` describes a file, `.list()` pages
  through the kind's folder, and `.at(path)` reads one by the path a
  listing gave, never changing it. The key's first
  part is what the file hangs off, so all of one customer's files are one
  prefix, and a row in Postgres keeps the key's parts. A kind's JSON schema
  only grows the way a column does, with optional fields, or the files
  kept before fail to read. Underneath, `appStorage()` keeps the bytes in
  Railway's `Storage` bucket through its S3 API in a build, with the
  `STORAGE_*` variables, and in `.storage/` in the checkout in a dev
  server. A test hands `new Storage(memoryStore().store)`
  (`source/database/tests/support/storage.ts`) to the route's `context` in its place.
- **A table goes in one of four Postgres schemas**, by who owns its rows
  and who sees them, and there's never another of ours, nor one per
  feature (features are folders in code). A fifth, `drizzle`, is Drizzle's
  own, its journal of the migrations applied, which `migrate.ts` reads and
  nothing of ours writes:
  - **`public`**, the business's own data, whatever the app is built to
    do: `pgTable(...)`. The users are here: they're the business's team,
    whom its other tables point at (`references(() => users.id)`).
  - **`auth`**, what lets someone in: the sessions and the API tokens:
    `auth.table(...)`. They're the most sensitive rows, since one is as
    good as a password, kept apart so a read-only role can be given
    everything but them. The login codes aren't here: Infra keeps them.
  - **`internal`**, the rest of the machinery, what no person sees, like
    an error log or rate limits: `internal.table(...)`.
  - **`dbos`**, DBOS's own tables, the workflows' runs and queues. DBOS
    makes and migrates it, nothing of ours writes to it, and Drizzle Kit
    leaves it alone (`schemaFilter` in `drizzle.config.ts`).

  `auth` and `internal` are declared in `schema/foundation.ts` and made by the first
  migration. The upgrade test's sample rows fill all three of ours
  (`SCHEMAS` in `tests/support/fill.ts`).

### Migrations

**The schema is code.** `schema.ts` is the source of truth, and every
change ships as a migration:

1. Edit the schema: the app's own tables are in `schema/app.ts`.
2. Run `pnpm database:generate --name=<what-it-does>` (with `--custom` for
   an empty one to write by hand). drizzle-kit diffs the schema into a new
   SQL file under `source/database/migrations/`, and its snapshot under
   `meta/`, which `pnpm format` then formats. **Read the SQL** — it is
   exactly what will run against production.
3. `pnpm dev` applies it to the checkout's database as it starts, and the
   tests apply every migration from empty. `pnpm database:check`, part of
   `pnpm check`, checks the journal's order and lints every migration with
   squawk (below). `pnpm database:upgrade-test` applies it over
   `origin/main`'s migrations, on a database with sample rows in every
   table, as CI's `tests` jobs do on the PR.
4. Commit the schema change and the migration together.
5. On merge, Railway runs `pnpm database:migrate`
   (`source/database/migrate.ts`) before the new version starts: every
   pending migration, in one transaction, recorded in
   `drizzle.__drizzle_migrations`. One that fails rolls back with all the
   others, and the deploy stops with the current version still serving.

Never hand-edit a migration that has already shipped (the upgrade test
fails one whose hash changed), never change production's schema by hand,
and never use `drizzle-kit push` (it changes the database with no
migration file to review or replay).

**A migration runs while the previous version still serves**, since it
runs before the new one starts. So:

- **It must be safe for the old code.** Adding a table, a nullable column,
  or a column with a default is safe. Renaming or dropping something the
  running code reads is not: do it in two deploys, first code that stops
  using it, then the migration that removes it.
- **A column in `schema.ts` is one the code uses**, whether or not anything
  reads it: Drizzle names every column its table has in the SQL it writes.
  An insert lists them all, with `default` for each one it isn't given,
  and `select()` and `.returning()` list them all too:

  ```sql
  insert into "users" ("id", "slug", "email", "name", "deactivated_at", "logged_in_at", "created_at")
  values (default, $1, $2, $3, default, default, default)
  ```

  So the deploy that stops using a column takes it out of `schema.ts`,
  and deletes the `DROP COLUMN` that `pnpm database:generate` then writes
  from its migration, leaving the column where it is: the version still
  serving names it, until the new one starts. A column that's `NOT NULL`
  without a default gets `DROP NOT NULL` in its place, since the new code's
  inserts leave it out. The next deploy drops it by hand, since the schema
  no longer has it for drizzle-kit to see go: in a migration of its own
  (`pnpm database:generate --custom`), or, when that deploy changes the
  schema too, in the one it generates, since `--custom` copies the
  snapshot before rather than writing the schema's. A table renamed is the
  same: its old
  name has to answer the old version, as a view under it
  (`CREATE VIEW "old" AS SELECT * FROM "new"`, which Postgres lets the old
  version write through), until the next deploy drops the view.
- **It must not hold a lock the app waits on.** The migration's connection
  sets `lock_timeout` to 10 seconds and `statement_timeout` to 240
  (`MIGRATION_SETTINGS`), under Railway's 300-second pre-deploy timeout, so
  one stuck behind a busy table, or one that runs too long, fails and rolls
  back rather than stalling the app or being killed part way. Building an
  index on a table that has rows blocks its writes until it's done, and
  `CREATE INDEX CONCURRENTLY` can't run inside the migration's transaction,
  so an index on a big table is built outside a migration, with a migration
  that only records it.
- **Existing rows must fit it.** A new `NOT NULL` column needs a default,
  and a new unique index fails on duplicates already there. The upgrade
  test (`source/database/tests/upgrade.test.ts`) fills every table with
  rows shaped to trip exactly that (`tests/support/fill.ts`: a null in each
  nullable column, the same value in each column outside a key), then
  applies the PR's migrations over them.
- **Every lock it takes is held until it commits.** A deploy applies every
  pending migration in one transaction, so a table any statement locks
  stays locked until the last one is done.
- **Data that moves is moved in pages**, by a job, not by a migration over
  a big table, which would run inside the deploy.

**squawk lints every migration** (`.squawk.toml`), in `pnpm database:check`:
for a lock that would hold up the app, like an index on an existing table
(`require-concurrent-index-creation`), and for a change the old version
can't survive, like a dropped column (`ban-drop-column`). When one is safe,
say why on the line before the statement, then the rule it breaks:

```sql
-- customers has a few hundred rows
-- squawk-ignore require-concurrent-index-creation
CREATE INDEX "customers_email_index" ON "customers" ("email");
```

**The journal's timestamps stay in order**, which `pnpm database:check`
checks. Drizzle applies only the migrations timed after the newest one a
database has, so one generated on a branch before another merged comes out
older, and would never run in production: generate it again on top. The
upgrade test fails it too, since the database ends up without it.

Once production's rows get big or varied enough that sample rows stop
standing in for them, rehearse each PR's migrations on a copy of
production too: copy it nightly into a second Railway environment, and
apply the branch's migrations to a copy of that in CI, timing each
statement.

### By hand

- **`pnpm database:sql "<query>"`** runs one query against the checkout's
  database, in a session that's read-only by default (a query that turns
  that off can still write), and prints the rows. For anything
  more, a `psql` of your own reaches it at
  `node source/database/local/server.ts url`. Write only to your own
  checkout's database.
- **`pnpm database:reset`** deletes the checkout's database and migrates a
  new one from empty.
- **`pnpm database:seed`** puts sample rows in it, to try things out on
  (`source/database/seed/seed.ts`, run by `workbench/scripts/seed.mjs`
  through Vite's module runner, so it can use the `@/` paths). **Every
  table gets a seeder, in the same change that adds the table**, the app's
  own in `seed/app.ts` (`APP_SEEDERS`), written out by hand, which
  replaces its rows, so seeding again is safe, and covers every state a
  screen shows, as `seed/users.ts` does for the users and their sessions.
  A table whose rows nothing should make up, like a log a job writes, goes
  in `APP_UNSEEDED` instead, with why. The
  seeded rows are what each branch's migrations first run over, in every
  checkout's database as `pnpm dev` starts, so an unseeded table is one a
  migration is never tried on before CI. Its test seeds an empty database,
  and fails on a table that's in neither, so a schema change that breaks
  the seed, or a table without one, fails `pnpm check`.
- **Production's** is in Railway's dashboard: the Postgres service's Data
  tab. It's only on Railway's private network, so a script that writes to
  it runs on the app's service, with `railway ssh --service app --
  <command>`, which has `DATABASE_URL`.

### Restoring production

**Production's database has point-in-time recovery**, from the first
apply (`.railway/railway.ts`). Postgres sends every change to the
`Postgres-PITR` bucket as it happens, with a full backup each week and a
differential one each day, so it can be restored to any moment in about the
last four weeks, starting from the first backup. Rolling back a deploy
doesn't roll back a migration, so data a migration, a script or a person
changed wrongly comes back this way, from the moment before, losing every
write since.

A restore moves production, so it's the human's to decide. It goes in four
steps:

1. **Restore into a new service**, which leaves the database as it is:

   ```bash
   railway postgres pitr restore --service Postgres --at 2026-11-20T15:04:00Z --new-service-name Postgres-restored
   ```

   The time is in UTC, or an offset back from now like `2h`.
   `railway postgres pitr status --service Postgres` shows the range there
   is to restore from, and the database's Backups tab on Railway does the
   same with a date picker.
2. **Check the restored data**, in the new service's Data tab, before
   anything points at it.
3. **Switch the app over in `.railway/railway.ts`**, in a PR: declare the
   restored service, point the app's `DATABASE_URL` at it, and give it
   point-in-time recovery as `Postgres` has it, with a bucket of its own,
   since a restored database doesn't archive until it's turned on. Until the
   file names the restored service, every push's apply fails, since it
   would delete it, which CI refuses. Merging deploys the app against it.
4. **Delete the old database last**, once nothing needs it, with the
   destructive apply the human runs (`workbench/commit-and-deploy.md`, "CI
   and deploys").

### Local development

**A fresh clone runs with `pnpm install && pnpm dev`**, on a Mac or on
Linux, with no Docker. There's no credential to set: `pnpm dev` starts the
checkout's own Postgres, applies the branch's migrations to it, and serves
on http://localhost:3000. The tests start it too, and make their databases
on it.

- **It's a Postgres 18 from npm**: `embedded-postgres` brings the binaries
  for the machine it's installed on, and `source/database/local/server.ts`
  makes the server with `initdb` the first time and starts it with
  `pg_ctl`. It runs in the background, like a database in Docker would,
  until `pnpm database:stop`, a restart, or half an hour with nothing
  connected, and `pnpm database:reset` empties it. It sorts text with ICU's
  `en-US`, as production's `en_US.utf8` does, and allows 500 connections,
  as Railway's does.
- **It stops itself once it's idle**: whatever starts it gives it a watch,
  a process of its own beside it (`local/idle.ts`), which counts what's
  connected every minute and stops the server once nothing has been for
  half an hour. Whatever needs it next starts it again, with its data, in
  about a second. A dev server holds a connection for as long as it runs
  (`local/hold.ts`), so it's never stopped under one. In
  `pg_stat_activity` the dev server's connection is `app dev server`, and
  the watch's own `app idle watch`.
- **Each checkout has its own**, with its data, its port and its log in
  `.postgres/` (ignored by git), so a branch's migration never lands under
  another worktree's code. Its port is picked free the first time and kept
  in `.postgres/port`. **A Mac runs at most 32 of them**, across every
  repo that uses this setup: each holds
  one of macOS's System V shared memory segments, and the 33rd fails to
  start with `could not create shared memory segment: No space left on
  device`. Under `pnpm test` that message is lost: vitest says `No test
  files found` instead. `node source/database/local/server.ts start` shows
  the real one. `pnpm database:stop` in a worktree whose branch has merged
  gives its slot back at once.
- **As root**, as a cloud sandbox's shell may be, Postgres runs as a
  `postgres` user, made if it's missing, since it refuses to run as root,
  with its data in the system's temporary folder.
- **The dev server only ever uses the checkout's database**, whatever
  `DATABASE_URL` says (`appDatabase()`), so it can't reach production's by
  accident.
- **Logging in works with nothing set up**: a dev server with no Infra
  test key logs in through an in-memory stand-in, which emails nothing
  and shows the code and the link on the page. With a test key of the
  project's (`INFRA_TEST_KEY` in the checkout's `.env`, from
  `.env.example`), it goes through Infra's test mode instead, the same
  calls production makes, still emailing nothing. A worktree with no
  `.env` of its own reads its main checkout's. A dev server never takes a
  secret key, so it can't email real people (`source/backend/infra/`).
  **The toolbar shows only with a test key Infra takes**: the stand-in
  keeps no comment, so a dev server on it has no toolbar
  (`source/frontend/components/toolbar/`).
- **`pnpm preview`** runs the production build (`pnpm build` first) as
  Railway does, `source/node.ts` and all, on the checkout's database, at
  http://localhost:3001. **`pnpm smoke-test`** does it on a new, empty
  database instead, migrating it first, and checks every page and the
  cache headers, as `pnpm check` and CI do (`workbench/scripts/smoke-test.mjs`).

## The verification loop

```bash
pnpm format       # biome: format, lint, organize imports
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest, in Node, against the checkout's own Postgres
pnpm dev          # http://localhost:3000
pnpm smoke-test   # the build (pnpm build first), migrated, started and probed as Railway runs it
pnpm check        # exactly what CI runs, its parts side by side (workbench/scripts/check.sh)
```

**Tests** are `*.test.ts` files under `source/`, run by vitest in Node with
`vitest.config.ts` (not `vite.config.ts`, whose plugins build the app). Put
them in a `tests/` folder beside the code they cover, like
`source/backend/tests/`. Code that queries the database runs against a real
Postgres, in a database of each test's own: `await testDatabase()`
(`source/database/tests/support/database.ts`) copies a template that every
migration was applied to once that run (`setup.ts`, vitest's global setup),
and drops the copy when the test finishes. So a route is tried on real rows
through the whole API, with `testApi()` (`source/backend/tests/support/api.ts`):
the API as the server mounts it, on a database of the test's own, the
bucket's bytes in memory, the workflows recorded rather than run, in
`started`, and Infra's stand-in, called through the typed client, as
`source/backend/health/tests/routes.test.ts` does. A route that needs
someone logged in gets them through the stand-in, as
`source/backend/auth/tests/routes.test.ts` does: its logins answer
their code. A workflow that needs
DBOS itself is tested as `source/backend/workflows/tests/engine.test.ts`
is. The server is the checkout's own, here and in CI, which the setup
starts when it isn't running.

## What biome enforces — don't hand-manage style

`pnpm format` applies these mechanically. Never spend effort on them — just
run it:

- No semicolons, double quotes, no trailing commas
- 4-space indentation, 80-character line width
- `import type` for type-only imports; imports kept sorted
- `const` over `let` where possible
- Unused variables and imports are errors; `any` is an error
- Markdown and JSON are formatted too

### No committed file may be one `pnpm format` always rewrites

Every committed file is in one of two states: **excluded from the formatter**
in `biome.json`'s `files.includes`, or **committed in the shape the formatter
produces**. Generated files that a tool rewrites on its own (TanStack
Router's `routeTree.gen.ts`) get excluded when they arrive; ones written
once, like drizzle-kit's migration snapshots, are formatted as they're
committed; anything a human
maintains stays formatted. If `pnpm format` on a clean tree reports a file
you didn't touch, fix it in a commit of its own rather than letting it ride
into an unrelated change.

Everything below is judgment biome _can't_ check — it's on you.

## Conventions

### Group related code together with descriptive comments

```typescript
// The posts, newest first, without drafts
const posts = await getPosts()
const published = posts.filter((post) => !post.draft)

// The projects each post links to
const projects = await getProjects()
```

### Use shorthand destructuring

```typescript
// Good:
const [post] = await database.select().from(posts).where(eq(posts.slug, slug))

// Bad:
const post = await database
    .select()
    .from(posts)
    .where(eq(posts.slug, slug))
    .then((rows) => rows[0])
```

### Use explicit logic instead of shorthand

When two paths are alternatives, write both arms:

```typescript
// Good
if (condition) {
    action()
} else {
    fallback()
}

// Bad — is the tail the `else`, or does it run either way?
if (condition) {
    action()
}
fallback()
```

This holds when the `if` arm `return`s or `throw`s too: keep each arm's exit
inside that arm. **The carve-out** is a genuine guard clause — validate and
bail at the top of a function, where nothing below belongs to the other case:

```typescript
// Fine — there is no "else"
if (post.draft) {
    return
}
```

### Never use type assertions unless absolutely required

Type assertions (`as`, `!`) should be used **almost never**. Needing one is
almost always a signal that something is mistyped upstream:

- **Wrong or loose type at the source?** Fix the declaration, the schema, or
  the generic — not the use site.
- **Value needs narrowing?** Use runtime checks (`typeof`, `in`,
  `Array.isArray`, `=== undefined`) or a discriminated union.
- **Data crossing a boundary** (a post's frontmatter, a webhook payload, an
  API response)? Parse it with a zod schema instead of asserting its shape.

The rare legitimate case deserves a comment explaining why it's safe.

### Zod where data comes in

**Parse with zod wherever data comes into the code from something
TypeScript can't vouch for.** TypeScript checks what the code itself
writes, at build time; it can't see what arrives while the server runs. So
a value is parsed with a zod schema where it comes in:

- **What the API receives**: a body, path parameters, a query string,
  through `validated()` (`backend/failures.ts`), never
  `await context.req.json()` with a type laid over it. The server checks
  every request, since scripts and agents call it too, not only our pages.
- **The environment**: variables read together are parsed with a schema
  named for them, by their names, like `storage/index.ts`'s
  `storage_environment`. One read alone is checked where it's read, as
  `DATABASE_URL` is.
- **Rows from raw SQL** (`client.query()`, `database.execute()`), which come
  back untyped: parsed, never typed with a generic like
  `client.query<{ taken: boolean }>()`. Rows from Drizzle's query builder
  are typed by their tables already. **A raw expression in a Drizzle
  select, `sql<T>`, states a type nothing checks**, so its SQL pins that
  type: a comparison is a boolean already, and anything else is cast to the
  type it claims (`::integer`, `::text`). `count()` and `sum()` answer
  `bigint` and `numeric`, and `round()` and `extract()` `numeric`, which pg
  hands over as strings: a `sql<number>` over one without `::integer` is a
  string at runtime.
- **Outside services**: their responses and the webhooks they send, parsed
  inside the service's wrapper, so its callers get typed values.
- **Anything stored and read back by a later version of the code**: a
  workflow's input (`defineWorkflow` checks it) and a step's result, a JSON
  column, a file (`storage/kind.ts`'s `json(schema)`), localStorage. The
  code that wrote it may be older than the code reading it.
- **Failures read in the browser** (`frontend/queries/failures.ts`), since
  one may be Railway's own page rather than the API's answer.
- **A form, before it's sent**, with the same schema its route checks with
  (`source/utilities/schemas/`), only so it can say what's wrong at once.
  The route checks it again regardless.

`.parse()` when it must fit, and `.safeParse()` when not fitting is a case
to handle. **When a schema exists, its type comes from it**: `z.infer`,
named in PascalCase below the schema's snake_case name, never a second
declaration of the same shape. A related shape comes from it with
`.pick()`, `.omit()` or `.extend()`.

**Everywhere else, a type is TypeScript's**, inferred from whatever already
defines the shape:

- **A row**, from its Drizzle table (`typeof posts.$inferSelect`).
- **What the API answers**, from the typed client (`InferResponseType`). A
  page doesn't parse what our own API sends back: the client's types are
  the contract, checked at build time, and the page and the API are built
  and deployed together.
- **A constant**, from its value (`as const`).
- **What a function answers**, from its return type, an `OperationResult`
  when it can fail (below).

A type is written out by hand (`type Station = { … }`) only when nothing
defines it. Data the code makes up itself, like a list typed into a
component, needs no schema: nothing outside can hand it a wrong shape, and
a schema that nothing parses only looks like a check.

### Tagged results for expected failures

Functions that can fail in expected, recoverable ways return an
`OperationResult` instead of throwing. It and `AsyncOperationResult` are global
types, declared in `source/globals.d.ts`, so no file imports them.

```typescript
async function getPost(slug: string): AsyncOperationResult<Post, "not-found"> {
    const [post] = await database
        .select()
        .from(posts)
        .where(eq(posts.slug, slug))

    if (post === undefined) {
        return { ok: false, error: "not-found" }
    } else {
        return { ok: true, data: post }
    }
}
```

Callers handle every outcome explicitly:

```typescript
const found = await getPost(slug)
if (!found.ok) {
    return found
}
const post = found.data
```

- **Always name the `Err` type** — a literal union
  (`"not-found" | "unpublished"`) when the name is the whole story, a
  structured object when the caller needs context.
- **Don't return bare sentinel unions** (`Promise<Post | "not-found">`). They
  collapse when the success type overlaps the sentinel (`string | "missing"`
  _is_ `string`) and can never carry a payload.
- **Not every string union is a failure.** `"active" | "retired"` are peer
  outcomes, not a result.
- **A result that's stored and read back**, like a workflow step's, is
  parsed as it's read, with a schema of its own
  ([Zod where data comes in](#zod-where-data-comes-in)).

Reserve `throw` for genuinely unexpected failures — things no caller could
meaningfully handle.

### Logging and tracing

Log with `console.*`; Railway keeps each deployment's logs (`railway logs`,
in a checkout linked with `railway link`, or the Railway MCP's `get-logs`).
Two rules regardless of where logs go:

- **Every `catch` logs**, including errors you handle, retry, or deliberately
  ignore. So does every external call's outcome, with its status.
- **Keep the message a static string** and put the variables in an object
  beside it: `console.error("Feed fetch failed", { url, error })`. An
  interpolated message can't be grepped back to its call site and splits one
  failure into many signatures, on the log and on the trace (below).

**Traces go to Railway's Traces page** while tracing is on for the service
(`tracing` in `.railway/railway.ts`, a preview behind the account's Tracing
beta), from OpenTelemetry in the server, which `source/tracing.ts` starts
before anything it instruments is imported: `pnpm start` loads it with
`--import`. It's traces only, since Railway keeps logs and metrics itself,
and most of a trace needs nothing from the code that runs in it:

- **Every request** the server answers is a span, inside the trace
  Railway's edge started (its `traceparent`), named for its route: a Hono
  app's by `traceRoutes` (`utilities/tracing.ts`), first in each app the
  server hands requests to, so `GET /api/workflows/runs/:id`, a page by its
  path (`source/node.ts`) and the admin as `/admin/*`
  (`source/server.ts`). A route that answers many addresses with one
  handler, like a `*`, names itself with `nameRequest`. A request the MCP's
  tool makes of the API in-process is a span inside the MCP's.
- **Every query** (`pg`, the app's and DBOS's) and **every call out**
  (`fetch`, `http`) is a span inside whatever's running. One outside any
  span isn't traced, so DBOS's polling of its queues isn't.
- **Every workflow run** is a trace of its own, named for its workflow,
  with a span for each step inside it, named for the step: DBOS's own spans
  (`tracingEnabled` in `backend/workflows/engine.ts`), each with its run's
  ID as `dbos.operation.workflow_id`. A route's log of the run it started
  has that ID. A runner a minute or more apart traces each turn, as
  `runner <name>` (`backend/workflows/runners.ts`).
- **What's logged while a span runs is kept on it**, as an event named for
  the message with the rest beside it, and the log line ends with
  `{ trace_id }`, so a log line leads to its trace and a trace has its own
  logs. An error logged marks the span `app.error_logged`.
- **A route that throws** marks its span failed, with the error and its
  stack (`recordError`, which `backend/failures.ts` calls).

For work worth a span of its own inside those, wrap it:
`await traced("import contacts", () => importContacts(database))`
(`utilities/tracing.ts`). Never put a secret, or a person's details, in a
span's name or its attributes: a trace is kept as long as the logs, and
everyone on the Railway project reads it. A query's span keeps its SQL,
never its values, and so does a failed query that's logged or marked on
a span: its statement and Postgres's own words, never what it was sent
(`withoutValues`, `utilities/tracing.ts`). The query parameters that
carry a credential or a person's details, like OAuth's `code`, are
redacted from every URL a span keeps of a request the server answers
(`REDACTED_QUERY`, `source/tracing.ts`): a new one goes on that list. A
call out, through `fetch`, is redacted only of signatures, by undici's
own list, so one that carries a credential in its query needs a
`requestHook` there.

**Reading production's**, as an agent: the Railway MCP's `list-traces`,
which filters with Railway's log syntax (`@status:error`,
`@http.route:/api/workflows/runs/:id`, `@duration:>500`, `@app.error_logged:true`,
`@dbos.operation.workflow_id:<id>`), then `get-trace` with a trace's ID, for
its spans as a tree; `get-tracing-coverage` shows what the app's own spans
cover; `railway trace list --json` does the same from a shell. A response
Railway traced carries its trace's ID in `x-railway-trace-id`. **Locally**,
`OTEL_TRACES_EXPORTER=console pnpm preview` prints each span as it ends; a
dev server and the tests trace nothing, and the smoke test checks the build
sends its spans to a collector of its own.

**What's trying to reach the app and can't is in the logs**, so look there
first when a webhook "never arrives", a link is said to be broken, or a
page fails for someone (`source/backend/misses/`). Each is one line, its
facts as JSON beside the message: method, host, path, user agent,
referrer, body type and size, and the names of any signature headers,
never a query string or a header's value.

- **`A request missed that looks meant for the app`**, a warning: nothing
  answers it, and it carries a webhook's signature header, sends JSON, is
  under `/api`, or came from one of the site's own pages (its `because`).
  The fix is the address the sender has, or the route.
- **`A request missed`**, information: nothing answers it, and nothing
  says it's meant for the app, like an old link from another site.
- **`A request failed`**, an error: answered 500 or more. What went wrong
  is logged just before it, where it happened.

What scanners try on every site (`.php`, `/wp-*`, `/.env`, `/.git`) is
never logged, unless it's signed like a webhook (`misses/sort.ts`).
`railway logs --lines 1000 --filter "A request missed"` lists the latest
misses, and `--filter "looks meant for the app"` the ones that matter.
Railway's own record of every request, with its status but none of what
says who sent it, is `railway logs --http --filter "@httpStatus:404"`.

### File naming and structure

- **kebab-case** for every file name.
- **The noun is the folder, the verb is the file.** `posts/render.ts`, not
  `render-post.ts` beside `posts/`. Group three or more siblings that share a
  noun into a folder; don't nest preemptively.
- **Keep files under 500 lines.** Split a file when it mixes unrelated
  concerns.

### Spelling

American English throughout — identifiers, comments, strings. `CLAUDE.md`
owns the rule.

## Each part's own guide

A directory's `README.md` owns its deep context. Read it before changing
anything there, and keep it current in the same change:

| Working on                                     | Read                                           |
| ---------------------------------------------- | ---------------------------------------------- |
| Logging in, the team, and who may do what      | `source/backend/auth/README.md`                |
| Your files, and what's in the bucket           | `source/backend/files/README.md`               |
| The database's folder, part by part            | `source/database/README.md`                    |
| Background work, schedules, events, runners    | `source/backend/workflows/README.md`           |
| A change to many rows, started on purpose      | `source/backend/jobs/README.md`                |
| Another service posting to the app             | `source/backend/webhooks/README.md`            |
| The site's analytics                           | `source/backend/visits/README.md`              |
| What the pages' script records                 | `source/frontend/visitors/README.md`           |
| Claude connecting to the app                   | `source/backend/mcp/README.md`                 |
| Calling Superforge Infra, and login through it | `source/backend/infra/README.md`               |
| The toolbar and its comments                   | `source/frontend/components/toolbar/README.md` |
| The Railway project                            | `.railway/README.md`                           |

A feature the app adds gets a README of its own when its context can't be
read from its code, and a line here.

## Before you call it done

- **Search before you declare.** Re-declared types, zod schemas, helpers and
  constants are the highest-cost decay, because duplicates diverge silently.
  Import the canonical one, or extend it with `.pick()` / `.extend()`.
- **Dead code** — exports nothing imports, functions whose only caller you
  just deleted.
- **Comments narrating obvious code.** Comments explain non-obvious intent;
  descriptive group comments (above) are the wanted kind.
- **Suppressed errors** — an empty `catch`, a `@ts-expect-error` without a
  reason.
- **Formatting** is biome's job. If style problems survived, the gate didn't
  run.

## Backward compatibility

When changing existing code and nobody mentioned backward compatibility:

- **Other callers?** Refactor them if that's cleaner.
- **Unsure?** Stop and ask.
- Never build in backward compatibility unless explicitly requested.

The one exception is **a published URL**. A page's address may be linked
from emails, ads, other sites and search results, so renaming a slug or
moving a route needs a redirect from the old path, once the site is
live. (The template itself redirects nothing of its own before 1.0: a
copy's live pages are its own.)

## Keeping this current

If a convention here fights reality, fix it in place when the correction
is small and certain, and otherwise tell the human what's wrong
(`CLAUDE.md`, "Keep things current as you go").
