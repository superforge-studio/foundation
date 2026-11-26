# 1. See it

The app running on the owner's computer, before any account but Claude.
It needs no credentials: `pnpm dev` runs a Postgres of the checkout's own,
and logging in shows its code on the page rather than emailing it.

## Whose history this is

Before changing anything: is this folder a git repository (`[ -d .git ] &&
echo yes`)? A download, from superforge.studio's start page, isn't, and
that's as it should be: `3-ship.md` starts the copy's own history, in a
private repository of the business's. If it is one, and `git remote
get-url origin` names `superforge-studio/foundation`, it's a clone of the
template, whose history is the template's, not the business's: with
nothing of the owner's in `git status`, delete it (`rm -rf .git`).

## Who you're working with

Unless the owner's first message already said, ask one question: **have
you worked with code before?** Then replace the placeholder under
`CLAUDE.md`'s "Who you're working with" with a few lines that fit the
answer, so every later session talks to them the same way:

- **New to code**: say what each step is for, in a sentence of plain
  words, before doing it. Name a tool the first time with what it is
  ("GitHub, where your code is kept"). Show the page rather than describe
  the code, and ask before anything that costs money or can't be undone.
- **Some**: say what you're doing and why, briefly, and explain only
  what's specific to this codebase.
- **A developer**: be brief. Name files and commands, and skip what they'd
  know.

Anyone else on the team who wants Claude to talk to them differently puts
it in a `CLAUDE.local.md` of their own, which git ignores.

## The tools

```bash
node --version
pnpm --version
```

Node has to be 22.18 or later in 22 (`engines` in `package.json`; `pnpm
dev` runs TypeScript files with Node itself, which an earlier 22 can't),
and pnpm the version `packageManager` names. Neither needs an admin
password or Homebrew:

- **No pnpm**: pnpm's own installer, which needs no Node, at the version
  this codebase uses:

  ```bash
  curl -fsSL https://get.pnpm.io/install.sh |
      env PNPM_VERSION="$(sed -n 's/.*"packageManager": "pnpm@\([^"]*\)".*/\1/p' package.json)" sh -
  ```

  It adds pnpm to the shell's profile, so the next command finds it. If
  it doesn't, start that command with
  `export PNPM_HOME="$HOME/Library/pnpm" PATH="$HOME/Library/pnpm:$PATH";`.
- **No Node, or an older one**: `pnpm env use --global 22`, which
  installs the latest 22 where pnpm keeps itself.

## Take out what only the template has

```bash
bash workbench/scripts/strip-template.sh
```

It deletes what `.superforge/template-only` lists as the template's own
(its release notes, `SECURITY.md`, Dependabot's version updates), the
template's sections of `README.md`, then the list and itself. So a copy
with no `.superforge/template-only` is stripped already: skip this.

## Run it

```bash
pnpm install
```

Then start the dev server. In the Claude app, its preview starts
`.claude/launch.json`'s `dev` and opens the page; anywhere else, `pnpm
dev`, then <http://localhost:3000>. The first start downloads this
checkout's Postgres, which takes a minute.

Show the owner the page. It's the template's own home: a line from the
page to the database, with a health check running down it, which shows
what the codebase has and that it runs. `2-taste.md` replaces it with
theirs.

## The check

The home page loads at <http://localhost:3000>, and its line shows the API
answering and the database connected. Then delete this file, and go on to
`2-taste.md`.
