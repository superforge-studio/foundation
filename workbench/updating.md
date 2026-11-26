# Updating from the template

Read this before taking a newer release of the template this codebase came
from (when the owner asks for the latest, for an update, or for a fix the
template has shipped), before checking whether one is out, and before
writing one in the template itself.

This codebase started as a copy of one of Superforge's templates, and
`.superforge/superforge.json` says which one, and which release it's on:

```json
{ "version": "0.1.0", "template": "foundation", "project_id": null }
```

The template is public, at `github.com/superforge-studio/<template>`, and
each release is a tag there (`v0.1.0`), with its notes in a file of their
own. An update takes what changed in the template between this codebase's
release and a later one, applies it here on a branch, and opens a PR.
There's no script and no account to log in to.

**The diff is between two of the template's releases**, never this
codebase against the template, which would show every change the owner
has made too. The template's own diff is only what changed upstream, and
`git apply --3way` merges it into the files as the owner has them.

## Where the releases are

- **The tags** are the list of releases: `v` and the version, on the
  template's `main`. A release is out once it's tagged.
- **Each release's notes** are `.superforge/releases/<version>.md` in the
  template, headed with its version and day (`# 0.9.0 (2026-11-22)`).
  Read only the ones after this codebase's version, from the template's
  latest tag, which has every release's file (step 3).
- **`CHANGELOG.md`**, in the template, is their index: a line per
  release, newest first.

Both are the template's alone: a copy made since 0.37.0 has neither, and
an update never brings them (`.superforge/template-only`). A copy made
before it may still have its own `.superforge/releases/` and
`CHANGELOG.md`, from its updates: delete them, since the notes are read
from the template's tags, and this codebase's own history is its git log.

Until 0.8.0, every release's notes were sections of `CHANGELOG.md`. 0.9.0
moved each into its own file, so a tag before `v0.9.0` has no
`.superforge/releases/`: read those releases' notes from a later tag.

## Whether a newer release is out

The template's tags, with nothing fetched and no remote added:

```bash
git ls-remote --tags --refs https://github.com/superforge-studio/foundation.git 'v*' |
    sed 's|.*refs/tags/v||' | sort -V
```

The repository's name is the `template` in `.superforge/superforge.json`.
A version after this codebase's `version` is a release it hasn't taken:
tell the owner what it brings (step 3) and that it's theirs to take. With
none, it's up to date.

## How a release is written

Every release, in the template, is a PR that changes what a copy gets
(the template's `README.md`, "This template", "Releases"). In that PR, its
notes go in `.superforge/releases/<version>.md`, a line for it at the top
of `CHANGELOG.md`'s list, and its version in
`.superforge/superforge.json`. The notes are written for the agent that
updates a copy, which reads every release between the copy's version and
the latest before it applies any of them. Each release says:

- **What changed, and why**, a part at a time, naming the files.
- **Machinery or a starting point**, for each part. Machinery is the
  setup every copy runs on (CI, the checks, the local Postgres, workflows,
  the Railway project's shape), so a copy takes it as the template has it.
  A starting point is something the owner is expected to make their own
  (the home page, the theme, an example feature), so an update offers the
  change and keeps the owner's version where they've changed it.
- **Flags**, when they apply:
  - **Schema**: the template's tables changed (`schema/foundation.ts`). The update applies the change and
    generates the copy's own migration (`pnpm database:generate`), since
    the template's migration files can't be copied (the update skips
    them). Any SQL written by hand is given here, to go in that migration.
  - **Variable** or **Secret**: a new variable on the app's Railway
    service. A secret's value is the owner's to set in Railway's
    dashboard before the update merges.
  - **Railway**: a change to `.railway/railway.ts` that costs money, or
    that needs a destructive apply.
  - **Owner**: a step only the owner can take, like a token or a DNS
    record.
  - **Deploy**: this release has to be deployed before the next one is
    applied, like a release whose code stops reading a column that a
    later release drops. An update stops after it (step 4).
- **How to tell a copy already has it**: a file, a line or a command's
  output that shows the change is there, for a copy that took some of it
  by hand.

A version is `major.minor.patch`. A patch release (`0.1.1`) fixes a bug or
makes a small improvement; a minor release (`0.2.0`) adds a feature or
changes something, and its notes flag a change to how something already
there works. The major moves only when Superforge says so: it stays `0`
until `1.0.0`, and after it, a release that breaks what a copy relies on
is a major (`2.0.0`). Every PR to the template is a release, so each tag
is one PR's change.

## What an update leaves out

- **`pnpm-lock.yaml`**: `pnpm install` brings it up to date with the
  updated `package.json`.
- **`source/database/migrations/`**: Drizzle runs only the migrations
  timed after a database's newest, and `pnpm database:check` fails one
  that's out of order, so the template's would land among this codebase's
  own and never run. The release's change comes across in the schema's
  files instead, and this codebase generates its own migration from it (step 4).
- **`source/frontend/routeTree.gen.ts`**: TanStack Router writes it from
  the routes, so a copy that has pages of its own would only conflict on
  it. `pnpm build` writes it again, with the release's routes and the
  copy's (step 4).
- **What a copy never keeps**: every path the template's
  `.superforge/template-only` lists, read from the release being applied,
  so a list a later release grows applies to it: what only the template
  has (its release notes, `CHANGELOG.md`, `SECURITY.md`, `dependabot.yml`,
  the list itself), and what only a copy's setup uses (`START-HERE.md`,
  `workbench/setup/`, the template's home page's line map,
  `source/frontend/components/welcome/`, with
  `source/frontend/queries/health.ts`). And the parts of a file a copy
  removed: the blocks of `README.md` between `<!-- template-only -->`
  lines, and `CLAUDE.md`'s first section (step 4, its rules).

## 1. Start clean

On `main`, up to date (`git switch main && git pull`), with nothing in
`git status --short`. `git apply --3way` needs every file it touches to be
as the last commit left it.

## 2. Fetch the template's releases

Add the template as a remote, once per checkout, then fetch its tags under
`template/tags/`, so they never mix with this codebase's own:

```bash
git remote add template https://github.com/superforge-studio/foundation.git
git fetch --no-tags template "+refs/tags/v*:refs/remotes/template/tags/v*"
```

Its releases, oldest first:

```bash
git for-each-ref --sort=v:refname --format='%(refname:lstrip=4)' refs/remotes/template/tags/
```

The ones after this codebase's `version` are what the update brings. If
there are none, it's up to date: say so, and stop.

## 3. Read the notes, and tell the owner

Read each release after this codebase's from its own file, at the latest
tag. Here, with `v0.10.0` the latest and this codebase on `0.8.0`:

```bash
git show template/tags/v0.10.0:.superforge/releases/0.9.0.md
git show template/tags/v0.10.0:.superforge/releases/0.10.0.md
```

**Then follow the latest tag's procedure, not this file**: read it with
`git show template/tags/v0.10.0:workbench/updating.md`, and follow that one
from step 4 on, since this file is the release this codebase is updating
from, and a later release may have fixed a step. The update brings it
here too.

Read each with its flags ("How a release is written", above). Then, before
changing anything, tell the owner in plain words what's coming, and get
their yes for anything that costs money, needs a secret, or needs them to
do something (**Railway**, **Secret**, **Owner**), and tell them of each
**Deploy**, which splits the update into PRs merged one after another.
Don't start an update they haven't agreed to.

## 4. Apply each release, in order, as its own commit

On a branch for the update:

```bash
git switch -c template-v0.2.0
```

Then each release in turn, from this codebase's to the next one, and so on
to the latest (here, `v0.1.0` to `v0.2.0`):

```bash
from=template/tags/v0.1.0 to=template/tags/v0.2.0
git diff --binary --no-color "$from" "$to" -- . \
    ':(exclude)pnpm-lock.yaml' \
    ':(exclude)source/database/migrations' \
    ':(exclude)source/frontend/routeTree.gen.ts' \
    $(git show "$to:.superforge/template-only" |
        awk '$1 !~ /^#/ && NF == 2 { sub(/\/$/, "", $2); print ":(exclude)" $2 }') |
    git apply --3way
```

The last line is the release's list of what a copy never keeps. A
release before `v0.37.0` has none (`git show` says the path doesn't
exist): in its place, exclude what was the template's alone then,
`':(exclude)source/frontend/components/welcome'`,
`':(exclude)source/frontend/queries/health.ts'`,
`':(exclude)SECURITY.md'`, `':(exclude)START-HERE.md'`,
`':(exclude)CHANGELOG.md'` and `':(exclude).superforge/releases'`.

A release at a time keeps each conflict small, with the notes for what
it's resolving beside it. What `git apply` says:

- **`Applied patch to '…' cleanly`** for every file, and an exit code of
  0: the release is in. `Falling back to direct application...` is a file
  it added or renamed, which is done too, and a change this codebase
  already has merges cleanly.
- **`does not exist in index`**: the release changes a file this codebase
  deleted or moved, and **nothing was applied**. Decide from the notes
  whether it still needs the change (machinery the owner moved: make the
  change where the file lives now, by hand; a starting point the owner
  removed: leave it out), then run the command again with
  `--exclude=<that path>` after `--3way`.
- **`Applied patch to '…' with conflicts`**: the release and the owner
  changed the same lines. `git diff --name-only --diff-filter=U` lists the
  files, each marked `<<<<<<< ours` (this codebase) and `>>>>>>> theirs`
  (the release). Resolve each by what the notes say it is: machinery takes
  the release's version, keeping anything the owner added to it on
  purpose; a starting point keeps the owner's, with the release's change
  worked in only where it still fits. When it isn't clear what the owner
  meant, ask them. Then `git add` the file. A conflict in `README.md`'s
  "This template" section, which a copy has removed, stays removed.

Three files have a rule of their own, since every copy has changed them:

- **`.superforge/superforge.json`**: the release's `version`, this
  codebase's `project_id`, and `template` as it is. Since `0.22.0`,
  `version` is the file's first line and `project_id` its last (null until
  the app is on Infra), so an update moves the version without meeting the
  ID. The update that brings `0.22.0` conflicts on it once, from the old
  layout, where `project_id` was added after `version`: write it as the
  release has it, with this codebase's ID, or null if it has none.
- **`CLAUDE.md`**: its first section, "First: is this codebase someone's
  yet?", stays removed, like `README.md`'s "This template", and "Who
  you're working with" keeps this codebase's words. The rules and
  the Workbench hooks take the release's, keeping what the owner added on
  purpose. The Project Architecture list is the template's: its bullets
  take the release's wording, and what this codebase says of its own
  areas goes under "This app's own", at the list's end, which no release
  changes. A copy from before `0.22.0` has its own areas written into the
  template's bullets: on the update that brings `0.22.0`, take the
  release's bullets and move each of this codebase's own into "This app's
  own", once, so the next update meets none of them.
- **`package.json`**: every dependency the template lists takes the
  release's version, whatever this codebase had (a Dependabot bump
  included), since the release's code is what was tested with it; the
  dependencies this codebase added of its own stay, and so do its `name`
  and the font it chose (`workbench/setup/4-make-it-theirs.md`). Then `pnpm install`.

Then, before the next release:

1. `pnpm install`, which brings `pnpm-lock.yaml` up to date, then
   `pnpm build`, which writes `source/frontend/routeTree.gen.ts` again
   from the routes, the release's new ones among them.
2. If the release flags **Schema**, generate this codebase's migration
   for it, named for what it changed, then add any SQL the notes give
   (or put it in a migration of its own, made with `--custom`). Read the
   SQL, as `writing-code.md`'s "Migrations" says:

   ```bash
   pnpm database:generate --name=<what-it-changed>
   ```

   If it asks whether a column or a table was renamed or made new, it's
   asking on a terminal, which an agent's shell may not have. Answer from
   the notes, in a terminal the owner runs it in if need be, never by
   guessing: a rename answered as new drops the old one's data.
   `pnpm check` fails while `schema.ts` has a change no migration holds
   (`workbench/scripts/check-migrations.sh`), so a Schema flag that was
   missed is caught there.
3. Check that `.superforge/superforge.json` says the release's version,
   which the diff brings.
4. `pnpm format`, and commit the release on its own. The tree was clean
   when the update began, so everything in it is the release's:

   ```bash
   git add -A && git commit -m "Template v0.2.0"
   ```

**A release flagged Deploy ends this update here**, after its commit:
check it and open its PR (step 5), and once it has merged and deployed,
start again from step 1 for the releases after it.

## 5. Check it, and open the PR

```bash
pnpm format && pnpm check
```

`pnpm check` runs the upgrade test, which applies the update's migrations
over `main`'s on a database with rows in it. Then run `pnpm dev` and look
at whatever the notes say changed. Push the branch and open the PR
(`commit-and-deploy.md`, "Pull requests"), titled like `template: v0.1.0
to v0.2.0`, and say in its body, for each release: what it brings, in a
line or two, how each conflict was resolved, and every flag, with the
secret to set before the merge, the Railway change, and the owner's steps.
Merging it deploys it, as with any PR, and it merges as any PR does: once
`check` passes, unless it has a migration, a secret to set first or
another step of the owner's, which wait for their go.

## When the version can't be trusted

If `.superforge/superforge.json` is missing, or this codebase plainly has
changes from a later release than its `version` (someone took them by
hand), start from the newest release whose notes' "How to tell a copy
already has it" all hold. When unsure, start earlier: a change this
codebase already has merges cleanly, but one skipped by starting too late
never arrives.

## Keeping this current

This file comes from the template, and updates bring its new versions. If
a step here is wrong, fix it in this codebase, and tell the owner, so
Superforge can fix it in the template too: as an issue on the template's
repository (`github.com/superforge-studio/<template>`), or, for a security
problem, privately, as the template's `SECURITY.md` says.
