# The database

Postgres, through Drizzle, and the `Storage` bucket beside it.
`workbench/writing-code.md` has the rules: "Data" for the conventions
every table follows, the four Postgres schemas and the bucket's kinds,
then "Migrations", "By hand", "Restoring production" and "Local
development". This is the map of the folder: what each part is, and where
to look. It's the server's alone: `backend/` imports it, with its own
scripts and tests, and nothing in `frontend/` does.

## `schema.ts` and `schema/`

**The source of truth for the tables.** `schema.ts` holds the conventions,
in its header, and exports every table, so the code imports them all from
`@/database/schema`. Each table is declared in the file of whoever owns
it: `schema/foundation.ts`, the template's, which an update from the
template changes, and `schema/app.ts`, this app's own, empty as the
template ships, which no update touches (`workbench/writing-code.md`,
"Yours and the template's"). `schema/namespaces.ts` has the Postgres
schemas beside `public`, `auth` and `internal`, in a file that imports
nothing of ours, so the two files of tables can point at each other
whichever loads first. drizzle-kit reads these files without the app's
`@/` paths, so what they import, they import by a relative path.

## `columns.ts` and `time.ts`

**What every table is written with.** `columns.ts` has the column types
the schema shares: `id()`, a uuid primary key Postgres makes;
`timestamp()`, a `timestamptz` to the millisecond, so a `Date` read back
and saved again compares equal to what's stored; and `textList()`, a
`text[]` that's empty rather than null. `time.ts` has the database's own
clock for comparing against stored timestamps: `now`, which is `now()`,
when the transaction started, and `fromNow(milliseconds)`, negative for
the past. A comparison written with them never mixes in the server's
clock.

## `migrations/` and `migrate.ts`

**`migrations/` is drizzle-kit's**: a SQL file for each migration, and
`meta/`, with a snapshot of the schema after each and `_journal.json`,
which orders them. `pnpm database:generate` writes them, by
`drizzle.config.ts` at the root, which leaves DBOS's schema alone
(`schemaFilter`). **`migrate.ts` applies them**: `migrateDatabase(url)`
opens one connection with `MIGRATION_SETTINGS` (a `lock_timeout` of 10
seconds and a `statement_timeout` of 240), has Drizzle apply every pending
migration in one transaction, recorded in `drizzle.__drizzle_migrations`,
then applies DBOS's own to the `dbos` schema (`DBOS.migrate`), and answers
how many of ours it applied. Run as a script it's `pnpm database:migrate`,
Railway's pre-deploy command, on `DATABASE_URL`, and exits 1 on a failure.
`pnpm dev`, the tests' setup and the upgrade test call the same function.
Node runs the file from source, so it imports only packages.
"Migrations" in `workbench/writing-code.md` has how a migration is
written, checked and shipped.

## `index.ts`

**The connection.** `connect(url, size)` is a pool through Drizzle, 10
connections unless it's told, which logs a connection that drops while
idle rather than crashing on it. `Database` is the type every operation
takes: the pool, or a transaction in it. `appDatabase()` is the server's
one pool, made the first time it's asked for, at `appDatabaseUrl()`:
`DATABASE_URL`, or this checkout's own in a dev server, whatever
`DATABASE_URL` says there. A route reads it from `context.var.database`,
and a script makes its own with `connect` and ends it with
`.$client.end()` (`workbench/writing-code.md`, "Data").

## `local/`

**This checkout's own Postgres**, a Postgres 18 from npm
(`embedded-postgres`), which the dev server, the tests and the
`database:*` scripts all start when it isn't running.
`workbench/writing-code.md`, "Local development", has why, the 32 a Mac
runs at once, and running as root.

- **`index.ts`** says where it is: `localDirectory()`, `.postgres/` in
  the checkout, which git ignores, and `localDatabaseUrl(database)`,
  `postgres://postgres@127.0.0.1:<port>/app` unless another database is
  named, which throws when the server has never started.
- **`server.ts`** starts it (`startLocalServer`). The first time, `initdb`
  makes `.postgres/data`, sorting text with ICU's `en-US`. Then `pg_ctl`
  starts it in the background, on a port picked free and kept in
  `.postgres/port`, logging to `.postgres/server.log`, reachable from
  this computer alone, with 500 connections and `fsync` off, since its
  data is made again in seconds. Then it makes the `app` database, and
  gives the server its idle watch.
- **`idle.ts`** is that watch: a process of its own, whose connection is
  `app idle watch` in `pg_stat_activity`. Each minute it counts the other
  connections, and once there have been none for half an hour
  (`IDLE_FOR`) it stops the server. An advisory lock keeps it to one a
  server.
- **`hold.ts`** is a Vite plugin (`vite.config.ts`) that holds one
  connection, `app dev server`, for as long as a dev server runs, so the
  watch never stops the server under one.

It stops on `pnpm database:stop`, when the watch stops it, or when the
computer restarts, and keeps its data each time. What drives it, the
scripts in `package.json` and one command of its own:

| Script                                       | What it runs                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `pnpm dev`                                   | `server.ts migrate`, the branch's migrations on the `app` database, then Vite's dev server |
| `pnpm preview`                               | The build, with `DATABASE_URL` from `server.ts url`                                        |
| `pnpm test`                                  | Starts it in vitest's global setup, and makes the tests' databases beside `app`            |
| `pnpm database:seed`                         | `server.ts migrate`, then the seed                                                         |
| `pnpm database:sql "<query>"`                | `server.ts sql`: one query on `app`, in a session that can't write                         |
| `pnpm database:reset`                        | `server.ts reset`: stops it, deletes `.postgres/`, and migrates a new one                  |
| `pnpm database:stop`                         | `server.ts stop`                                                                           |
| `node source/database/local/server.ts start` | Starts it and nothing else, and prints what went wrong when it can't                       |

`pnpm database:migrate` isn't one of them: it's production's, on
`DATABASE_URL`. A reset leaves `.storage/` as it was.

## `seed/`

**Sample rows for this checkout's database**: `pnpm database:seed`.
`seed.ts` lists the template's seeders in `SEEDERS`, in the order they
run, a table after the ones its rows point at, and the app's own after
them (`APP_SEEDERS`, `seed/app.ts`). A seeder takes the transaction,
deletes its table's rows, inserts its own, written out by hand, and
answers `{ table, rows }`, as `users.ts`'s do. `seed()` runs them all in
one transaction. A table that gets no rows is in `UNSEEDED` instead
(`APP_UNSEEDED` for the app's), with why, by its name as a seeder says
it: bare in `public`, `auth.sessions` in another schema. Its test
(`tests/seed.test.ts`) seeds an empty database twice, and fails a table
that's in neither list, a seeder that wrote nothing, and a name no table
has.

After the rows, `seedLocalDatabase` does two more things. It keeps the
sample files' bytes in this checkout's `.storage/`, each under its row's
ID (`keepSampleFiles`, `files.ts`). And it puts real runs on their queues
for a dev server to run, rather than writing DBOS's rows:
`tell-team-of-new-member` for each of the team, and whatever
`appSampleRuns` answers. `workbench/scripts/seed.mjs` runs it through
Vite's module runner, since the seed imports through `@/` paths. "By
hand" in `workbench/writing-code.md` has the rule that every table gets a
seeder.

**It never reaches production.** Its sample session logs in as the first
of the team with a cookie anyone can read here
(`session=sample-session-team`, `users.ts`), so the seed writes only
this checkout's own Postgres (`localDatabaseUrl()`), never
`DATABASE_URL`, nothing the server runs imports it, and no script but
`database:seed` and nothing in `.railway/railway.ts` runs it, which its
test holds.

## `storage/`

**The `Storage` bucket, for files.** A route or a step only ever sees the
`Storage` class, `context.var.storage` in a route, with a getter for each
kind of file; `workbench/writing-code.md`, "Data", has what a kind is and
every call it takes.

- **`files.ts`** is the template's kinds, on `FoundationStorage`: `files`,
  Your files, and `visitor_salt`, with `kinds`, which lists them, and
  `unclaimed()`. **`app.ts`** is `Storage`, which extends it with this
  app's own kinds.
- **`kind.ts`** is one kind's files, `Files<Key, Body>`: the key checked
  by zod, the path made from it, and the calls. Its formats are what a
  kind's files hold: `json(schema)`, checked as it's kept and as it's read
  back, `text(content_type)` and `bytes(content_type)`.
- **`index.ts`** has `ObjectStore`, bytes under keys, which the kinds
  are built on, and `appStorage()`, the server's: the bucket in a build,
  and a folder in a dev server.
- **`bucket.ts`** is Railway's bucket through its S3 API, each request
  signed with the `STORAGE_*` variables Railway sets and made up to three
  times when it fails for a reason that may pass. The variables are read
  the first time a file is touched (`bucketConfiguration`), so a build
  missing them still answers, and what touches a file throws, naming each
  one that's missing or wrong.
- **`folder.ts`** is a dev server's: each key a path under `.storage/`
  in the checkout, which git ignores. It keeps only the bytes, so a
  file's content type is guessed from its name.
- **`listing.ts`** pages a listing the way S3 does, for the two stores
  that list for themselves, the folder and the tests' memory.

**Only the bucket signs.** `presignGet` and `presignPost` make a link and
an upload form a browser uses straight against the bucket, for 90 days at
most (`LONGEST_PRESIGN_SECONDS`). A dev server's folder answers
`not-presignable` to both, and its caller serves the file itself with
`open`, or takes the bytes and calls `put`, as `backend/files/` does.

## `tests/`

**What the tests stand on**, in `support/`. "The verification loop" in
`workbench/writing-code.md` has how a test uses them.

- **`setup.ts`** is vitest's global setup: it starts the checkout's
  Postgres and makes the run's template database, with every migration
  applied by the function the deploy runs, named for the run's process so
  two runs at once don't meet.
- **`database.ts`**'s `testDatabase()` is a database of one test's own: a
  copy of the template, with a pool of two connections, dropped when the
  test finishes. Call it inside a test.
- **`fill.ts`**'s `fill(client)` puts three rows in every table of ours,
  whatever version of the schema the database is at, since it reads the
  tables from Postgres's catalog rather than `schema.ts`, shaped to trip
  a migration that existing rows break ("Migrations" has how).
  `fill.test.ts` holds it to the checks a copy's tables may have.
- **`upgrade.test.ts`** runs only when `UPGRADE_FROM` names a ref, as
  `pnpm database:upgrade-test [ref]` and CI's `tests` jobs set it: the
  ref's migrations, from git, then `fill`, then this branch's over the
  rows, and the database must end up with exactly the journal's
  migrations recorded.
- **`storage.ts`**'s `memoryStore()` is the bucket's bytes in memory, for
  `new Storage(memoryStore().store)`: `files` is what was kept, `fail()`
  makes the next put throw, and it signs links that only name what
  they're for, or can't sign at all with `{ presigns: false }`, as a dev
  server's folder can't.

Each part's own tests are beside it: `local/tests/`, `seed/tests/` and
`storage/tests/`.
