# Commit and deploy

Read this before committing, opening a PR, or shipping anything.

## Everything reaches `main` through a pull request

Work on a branch, one per task, named for it:

```bash
git switch main && git pull
git switch -c home-page-copy
```

Commit there as you go. **Push the branch and open the PR only when you're
asked to ship** — until then the commits stay local. Commit path-limited,
and check `git status --short` first so you don't sweep up someone else's
uncommitted work:

```bash
git commit -F - -- source/frontend/routes/index.tsx README.md
```

Merging a PR is shipping it (below), so a ruleset on `main` keeps a broken
build off production: `main` can't be deleted or force-pushed, and it
changes only through a pull request with a passing `check`, with no
approvals (a solo developer can't approve their own PR). The ruleset is
in the codebase, `.github/rulesets/main.json`, as Railway is in
`.railway/railway.ts`, and `pnpm github:ruleset` puts it on the
repository on GitHub: it makes the ruleset, or makes the one there match
the file, as whoever `gh` is logged in as. Change the file, never the
ruleset in GitHub's settings, then run it again. Nothing else depends on
the ruleset: CI runs and Railway deploys the same without it.

## The two gates

- **Local commit:** `pnpm format`, plus `pnpm typecheck` if code changed.
- **Push or PR:** `pnpm format && pnpm check`. `pnpm check` is exactly what
  CI runs, its parts side by side as CI's jobs run them: biome in read-only
  mode, the migration check, the typecheck, the tests against the
  checkout's own Postgres with the upgrade test, the production build with
  its prerender, and the smoke test (`workbench/scripts/check.sh`). Run it before you push
  rather than finding out from CI.

## CI and deploys

`.github/workflows/ci.yml` runs on every pull request and every push to
`main`:

- **`code`** and **`tests`** run `pnpm check` between them, side by side:
  `code` is biome, the migration check, the typecheck, the build and the
  smoke test (`check.sh code`), and `tests` the tests in two shards (`check.sh tests
  1/2` and `2/2`), each on a Postgres of the runner's own from npm, as on a
  laptop, with the PR's base (or `main`, on a push) as the upgrade test's:
  the base's migrations, sample rows in every table, then the PR's
  (`source/database/tests/upgrade.test.ts`). A new `NOT NULL` column or
  unique index that existing rows break fails it, and so does a migration
  the deploy would skip.
- **The smoke test** (`workbench/scripts/smoke-test.mjs`, the end of
  `code`) does with the build what a deploy does, on a new database of its
  own: `pnpm database:migrate` from empty, `pnpm start`, then
  `/api/health`, every prerendered page, a hashed asset and a missing page,
  each with the status and cache header `source/node.ts` promises, and
  last, that the server launched its workflows. So a start that crashes, a
  migration that won't apply from empty, a broken cache header or
  workflows that never start fail the PR, not the deploy.
- **`check`** is the gate: it passes once `code` and every shard of `tests`
  have. A failure shows on the PR and on the commit. Read why with
  `gh run list --limit 5` and `gh run view <id> --log-failed`. The `main`
  ruleset requires it, by its name.
- **`railway-apply`**, on a push, runs `railway config apply --yes` once
  `check` passes. It's the only job with production's token, so only
  merged code runs with it: a project token can do anything in its
  environment, read production's secrets among it, and a job on a PR runs
  the PR's own code. So a PR shows no preview of what it changes on
  Railway: the human runs `railway config plan` in a checkout linked with
  `railway link`, and an agent sees a change once it merges. Until the
  repository has the `RAILWAY_TOKEN` secret ("Setting up Railway", below),
  it skips with a notice, so a new copy's pushes pass before it has a
  Railway project.
- **`release-version`**, on a PR to the template, checks the PR is a
  release (`README.md`, "Releases"): its version in
  `.superforge/superforge.json` is the one right after its base's, with
  its notes in `.superforge/releases/` and its line in `CHANGELOG.md`.
  `check` waits for it. Of two PRs made side by side, the second to merge
  conflicts on the version once the first has, and after its rebase this
  checks it took the version after the first's. A copy skips it, and so
  do Dependabot's PRs.
- **`release-tag`**, on a push, in the template only, tags a release once
  `check` passes. When the version in `.superforge/superforge.json` has no
  tag yet, it tags the commit on `main` that set that version, `v` and the
  version, and pushes the tag, which is the release going out (`README.md`,
  "Releases"). It refuses a version without its notes,
  `.superforge/releases/<version>.md` headed with it, and its line in
  `CHANGELOG.md`, since the agent updating a copy reads those notes first. A copy skips it
  (`github.event.repository.is_template`), since a copy's version says
  which template release it's on. Railway waits for the whole run, so a
  release whose tagging fails doesn't deploy the template's own site
  either.

**The workflow holds itself to a few rules**: its token can only read the
code (`permissions`), but `release-tag`'s, which may push its tag, each job stops after 15 minutes rather than GitHub's
six hours, and a new push to a PR's branch cancels the run on the push
before it (`concurrency`), while pushes to `main` each run to the end, in
order. It reads Node's version from `engines` in `package.json`, as
Railway does, so the two can't drift.

**Dependabot** (`.github/dependabot.yml`) opens a PR a month for what's out
of date: one for GitHub's actions, one for every dependency's minor and
patch releases, and one each for a major release. Each passes `check`
before it can merge, like any PR. Security fixes come as soon as there's
one, once Dependabot security updates are on (Settings → Code security).

**Railway deploys each push to `main`** through its GitHub connection,
once that push's whole CI run has passed (Wait for CI: `checkSuites` in
`.railway/railway.ts`), so its configuration is applied before its code
deploys, and a push whose `check` or apply fails doesn't deploy. It builds
with `pnpm build` (Railpack, on Node 22 from `engines` in `package.json`),
then runs `pnpm database:migrate` before the new deployment starts, while
the one before still serves (`source/database/migrate.ts`): every pending
migration in one transaction, with a 10-second lock timeout, then DBOS's
own, in its `dbos` schema. One that fails rolls back, and Railway stops the
deploy with the current version still serving. Then it starts `pnpm start`
(`source/node.ts`), and moves traffic to the new deployment only once
`/api/health` answers, which needs the database, so one that doesn't start
never serves. Meanwhile its workflows wait at the gate the old one holds
(`source/backend/workflows/README.md`). The old one gets SIGTERM, stops its
workflows, which lets the new one's launch and carry on whatever runs were
left, finishes its requests, sends its last spans and exits. Read a
deployment's logs with `railway logs`, in a checkout linked with `railway
link`, or with the Railway MCP server, and its traces on the project's
Traces page or with the MCP's `list-traces` and `get-trace`
(`workbench/writing-code.md`, "Logging and tracing").

**The project's configuration is `.railway/railway.ts`**, Railway's
infrastructure as code: the app service, its build, pre-deploy migrations,
start, healthcheck, CDN, tracing and variables, the Postgres database with its
point-in-time recovery bucket, and the `Storage` bucket for the app's
files. Railway doesn't read it as it deploys. `railway config plan` shows
what applying it would change, and `railway config apply` changes it; CI
applies it on each push (above), with the `RAILWAY_TOKEN` secret.
**Change Railway in this file, not the dashboard.** Each push's apply puts
back any setting the file says otherwise, and the file owns every service variable: one set only in
the dashboard is a deletion the apply refuses, which fails the push and
skips its deploy. A secret goes in as `preserve()`, which keeps the value
set in the dashboard.

The apply refuses any destructive change (deleting a service, a volume or a
variable), since CI runs it without `--confirm-destructive`. When a PR means
one, the human applies it by hand once the PR merges, with `railway config
apply --confirm-destructive` in a checkout linked with `railway link`, then
re-runs the failed job so the push deploys.

**A project token can't turn tracing on or off** (Railway's `railway
trace` docs), so a change to the service's `tracing` in the file is made
with a login before the PR merges, `railway trace enable --service app`
(or `disable`), in a checkout logged in with `railway login`, and CI's
apply then finds nothing to change. The first apply, run by hand ("Setting
up Railway", step 3), turns it on with the rest.

**There is no manual deploy.** Production's code only changes by merging a
PR, so every deploy has passed `check` first. The one other way a version
goes out is a variable changing in Railway, which redeploys the running
code with it.

## Setting up Railway

Once per copy of this codebase, before its first deploy. Agents don't
create tokens, change repository settings (but for the `main` ruleset,
from its file, step 5) or touch DNS: the steps marked
**(the human)** are the owner's, and an agent says what's needed and waits.

**What you'll need**, before step 1:

- **Accounts**: GitHub, holding this repository, private (`START-HERE.md`,
  step 0). GitHub has rulesets on a private repository only on a paid
  plan (Pro, Team or Enterprise): on a free one step 5 says so and goes
  on, and the copy runs without its ruleset. Railway, on the Hobby or Pro plan. And
  Superforge, on superforge.studio, for the app's project on Superforge
  Infra, which sends the login emails: production's login doesn't work
  without it (step 6). Infra is Superforge's hosted service; its price and
  terms are Superforge's, on superforge.studio.
- **CLIs**: the Railway CLI, at the version CI uses
  (`npm install --global @railway/cli@5.71.0`, as in
  `.github/workflows/ci.yml`), and GitHub's `gh` (<https://cli.github.com>),
  logged in with `gh auth login`.
- **Two secrets**, both the owner's to make and set, never an agent's:
  `RAILWAY_TOKEN`, a repository secret (step 4), and `INFRA_SECRET_KEY`, a
  variable on the Railway service (step 6).

1. **(The human)** A Railway account on the Hobby or Pro plan, with
   Railway's GitHub app allowed to read this repository (railway.com →
   Account Settings → GitHub).
2. Name things for the business in `.railway/railway.ts` (`START-HERE.md`,
   step 5): the project, `github("<owner>/<repository>")`, the service's
   Railway address, `<name>.up.railway.app`, which has to be free across
   all of Railway, and the region nearest its customers, `REGION`, which
   the app, the database and the buckets share. The service is `app`, in
   every copy.
3. Make the project, from the repository's root, logged in with `railway
   login`:

   ```bash
   railway init --name <project>
   railway config apply
   ```

   The first apply makes the service and its Postgres, with point-in-time
   recovery on (`writing-code.md`, "Restoring production"). Railway may make
   the database in its default region whatever `REGION` says, and leave
   Wait for CI off on the new service: run `railway config plan`, and if it
   shows either, `railway config apply --confirm-destructive` once more
   (moving an empty database loses nothing). Then check that recovery is
   on:

   ```bash
   railway postgres pitr status --service Postgres
   ```

   It says `Status: enabled` and `Bucket wired: yes`. Within about ten
   minutes, the database's logs (`railway logs --service Postgres`) show
   its first full backup end with `completed successfully`; until then
   there's nothing to restore from. If the status says `disabled`, run
   `railway postgres pitr enable --service Postgres`, then make
   `.railway/railway.ts` match what it changed, so the plan is clean.

   Tracing (`tracing` in `.railway/railway.ts`) is a Railway preview,
   behind the account's Tracing beta. If the apply refuses it, or the
   service shows no traces, turn the beta on in the account's settings on
   Railway, or set `tracing: { enabled: false }` in the file. The app runs
   the same without it: `source/tracing.ts` stays off without the `OTEL_*`
   variables, and its logs are all there is to read.
4. **(The human)** A project token for the `production` environment (the
   project's Settings → Tokens on Railway), set as the repository secret
   that `railway-apply` uses:

   ```bash
   gh secret set RAILWAY_TOKEN
   ```

   It asks for the value, so it never lands in the shell's history. Until
   it's set, `railway-apply` skips with a notice. **Once Railway is set up,
   keep it set**: a push that skips deploys its code without applying its
   configuration. **If the token is revoked or expires, `railway-apply`
   fails on every push, so Railway deploys nothing** (Wait for CI): set a
   new one, then re-run the failed job (`gh run rerun <id> --failed`) and
   the push deploys.
5. The `main` ruleset (above), from its file:

   ```bash
   pnpm github:ruleset
   ```

   An agent runs it, with the owner's `gh` login. On a GitHub plan with
   no rulesets for a private repository it says so and passes: tell the
   owner in one line, and go on.
6. **(The human)** Login, through Superforge Infra
   (`source/backend/infra/README.md`). On superforge.studio's dashboard,
   the Infra tab:
   1. Make a project for this app, named as its login emails should say
      it (`Acme Plumbing <login@system.superforge.studio>`).
   2. Add its domains: the service's Railway address
      (`<name>.up.railway.app`) and its custom domain, if it has one. A
      login email links back only to a domain on this list, and holds
      the code alone otherwise.
   3. Make a secret key (`sf_secret_…`), and set it as `INFRA_SECRET_KEY`
      on the `app` service, in Railway's dashboard (the service's
      Variables). `.railway/railway.ts` keeps it with `preserve()`. Until
      it's set, the site works but login answers that it's down.
   4. For development, a test key (`sf_test_…`) as `INFRA_TEST_KEY` in the
      checkout's `.env` (`.env.example`). Optional: without one, a dev
      server logs in through a stand-in.

   The key is shown once. To check it reached Infra:

   ```bash
   curl -H "Authorization: Bearer <the key>" https://infra.superforge.studio/v1/project
   ```

   It answers the project and `"mode": "live"`. Then write the project's
   public ID (`sf_project_…`) as `project_id` in
   `.superforge/superforge.json`: nothing in the app reads it, but it's
   how Superforge's tools, and an agent, know which Infra project this
   codebase is.
7. Merge to `main`. The push's CI applies the configuration, and Railway
   deploys it. Open the service's address: the home page loads, (on the
   placeholder page) its line shows the API answering and the database
   connected, and `/login` emails a code.

Nothing for cloud agents: an agent needs no credential to develop, test or
run `pnpm check`, since `pnpm dev` and the tests run against the checkout's
own Postgres, which `pnpm install` brings.

## Domains

The app answers at Railway's address for it, named in
`.railway/railway.ts` as the app's `networking.serviceDomains`. The first
apply makes it with the service, since Railway's CDN needs a public domain
to start on (an apply without one fails, saying so). **After that the file
doesn't keep it**: if it's deleted, the plan doesn't notice, and it comes
back only from the service's Settings → Networking → Generate Domain. A
custom domain joins it under `customDomains`.

**The file can keep a custom domain but can't create one**: `railway
config plan` refuses a new name under `customDomains`. Add it first with
`railway domain <name> --service app`, which prints the two DNS
records it needs, then declare it in the file in the same change, so the
next apply keeps it rather than deleting it.

**(The human)** adds those records where the domain's DNS is: a CNAME (at
the apex, `@`, for a bare domain; most DNS hosts flatten it) to the
service's `*.up.railway.app` target, and a TXT record at `_railway-verify`.
On Cloudflare, make the CNAME **DNS only (gray cloud), not proxied**, so
Railway's CDN is the one cache in front of the app. A proxy in front of
Railway also hides each visitor's address: the app reads it from
`X-Real-IP`, which is whatever connected to Railway's edge, so behind
Cloudflare's proxy every visitor would share Cloudflare's addresses, one
country and one rate limit. Railway issues the
certificate within minutes; `railway domain status <id>` shows it.

**(The human)** adds the custom domain to the app's project on
superforge.studio's dashboard too (the Infra tab), so login emails link
back to it ("Setting up Railway", step 6). Until it's there, they hold the
code alone, and logging in still works.

## Caching

Railway's CDN serves the app at the edge (`cdn` in `.railway/railway.ts`,
<https://docs.railway.com/networking/cdn>), and `source/node.ts` says what
it, and browsers, may keep:

| What                                         | `Cache-Control`                       | Kept by the edge                |
| -------------------------------------------- | ------------------------------------- | ------------------------------- |
| The hashed build files, under `/assets/`     | `public, max-age=31536000, immutable` | for good                        |
| The prerendered pages                        | `public, max-age=0, s-maxage=86400`   | a day, or until the next deploy |
| Anything else in `public/`, like the favicon | `public, max-age=0, s-maxage=3600`    | an hour                         |
| `/api/*`, and anything rendered on request   | `no-store`                            | never                           |

**Each deploy purges every page from the edge** (`purgeOnDeploy: "html"`,
Railway's default, written out in the file), so there's no purge job. The assets stay, so a page
still open across a deploy can fetch the old ones it asks for. Browsers ask
for a page again on every visit (`max-age=0`), and the edge answers. A
changed favicon takes up to an hour to show; `railway cdn purge all` clears
it sooner. A page that shows something different to each person mustn't be
prerendered, and its response must say `private` or `no-store`.

To see what the edge did, read a response's `x-cache` header (`HIT`,
`MISS`, `STALE`, or `DYNAMIC` for what it doesn't keep):

```bash
curl -sI https://<domain>/ | grep -i -E "x-cache|cache-control|age"
```

## Pull requests

When you're asked to ship, push the branch and open the PR with
`gh pr create`:

- **In the template itself** (its `README.md` still has its "This
  template" section), **read that section's "Releases" first**: a PR that
  changes what a copy gets is a release, with its version and its notes
  in the same PR.
- **Title it with what changed**, by area: `website: the services page`,
  `api: book a call`, `database: customers`.
- **Put anything the human has to do around the merge in the body**: a
  secret to set, a DNS record, a destructive apply to run.
- **Call out a changed URL**: a renamed page breaks links to it unless it
  redirects.
- **Watch `check`** with `gh pr checks --watch`, and fix anything it finds.
  Merge only when the human says to (`gh pr merge --merge`), then
  `git switch main && git pull`.

## Variables and secrets

The server's configuration is Railway variables on the app's service,
named in `.railway/railway.ts`: `DATABASE_URL` (a reference to the
database's), the `Storage` bucket's S3 credentials as `STORAGE_*`
(references to the bucket's), `LOCATION_DATABASE` (which of DB-IP's
databases places a visitor by their IP address,
`source/backend/visits/README.md`), and any secret as `preserve()`, whose
value the human sets in Railway's dashboard, like `INFRA_SECRET_KEY`,
login's key ("Setting up Railway", step 6). Railway provides its own
beside them, which the file doesn't name: the `RAILWAY_*` ones, and, while
the service is traced (`tracing` in the file), the `OTEL_*` ones that say
where its collector is, which turn the server's tracing on
(`source/tracing.ts`). A new one goes in the file first,
since the file owns every variable on the service (above), and a new
secret is named in the PR so the human sets it before the merge. Never put a secret's value in the
file, and never commit one: `.env*` is ignored for that reason.

A dev server needs none of them: it uses the checkout's own Postgres,
keeps files in the checkout's `.storage/` folder, logs in through Infra
with a test key from the checkout's `.env`, or a stand-in without one,
places no visitor, and reads anything else from the shell that started it.
