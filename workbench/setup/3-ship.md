# 3. Ship

The app live on Railway with the business's name on it, and the owner
logged in to it. The owner makes the accounts, clicks what only they may
click and pastes two keys, each in the page it goes in. Claude does the
rest. In order: Superforge, GitHub, two questions, Railway, the Infra
key, the first deploy, the proof, and Railway's token last, since nothing
waits on it.

`workbench/commit-and-deploy.md`, "Setting up Railway", is the reference
for every Railway step here: read it before starting.

## Superforge

The app's login emails go through Superforge Infra, in a project of the
owner's on superforge.studio. Superforge's tools for it are an MCP server,
`superforge` in `.mcp.json`.

- **If its tools aren't in this session** (`get_project`,
  `describe_project` and the rest): Claude Code reads `.mcp.json` as a
  session starts in this folder. Ask the owner to start a new session in
  the Code tab, in this folder, and say "go on" there. Claude Code asks
  them to approve `superforge`.
- **To log in**, the owner types `/mcp`, picks `superforge`, and presses
  Allow on superforge.studio's page in the browser, logging in there
  first if it asks.

Then the project:

1. **Which one.** The owner's first message gave their project's ID
   (`sf_project_…`): read it with `get_project`. With no ID, ask which of
   `list_projects` is this app's, or make one with `create_project`.
2. **Its name**, which the login emails say they're from: the business's
   name from step 2. If it isn't, `describe_project` sets it.
3. **Write its ID** as `project_id` in `.superforge/superforge.json`.
4. **Describe it** with `describe_project`: a few plain paragraphs on
   what the business is and does, who it serves, and what this app is for,
   from what the owner has said, with no secrets and nobody's personal
   details. Step 4 describes it again, with everything they've said, and
   `CLAUDE.md` keeps it current after that.

## GitHub

The code's home: a private repository of the business's own, which
Railway deploys from.

- **Whose.** Ask whose business this is. If a developer or an agency is
  setting it up for a client, the repository goes under the client's
  account or organization, with them invited to it: the license has the
  business hold its own copy (`LICENSE`, term 2).
- **An account.** If the owner has none, they make one at
  <https://github.com/signup>. The free plan is enough.
- **git.** `git --version`. On a Mac without Apple's developer tools, that
  opens a dialog to install them: the owner clicks Install, and you wait.
- **GitHub's CLI**, `gh`. `gh --version`, and if there's none, from its
  release, with no Homebrew or admin password:

  ```bash
  (
      arch=$(uname -m); [ "$arch" = x86_64 ] && arch=amd64
      url=$(curl -fsSL https://api.github.com/repos/cli/cli/releases/latest |
          grep -o "https://[^\"]*_macOS_${arch}\.zip" | head -1)
      mkdir -p "$HOME/.local/bin" && cd "$(mktemp -d)" &&
          curl -fsSL -o gh.zip "$url" && unzip -q gh.zip &&
          cp ./*/bin/gh "$HOME/.local/bin/gh"
  )
  ```

  If `$HOME/.local/bin` isn't on the `PATH`, add
  `export PATH="$HOME/.local/bin:$PATH"` to `~/.zshrc`.
- **Log in.** `gh auth login --web --git-protocol https`, which shows an
  eight-character code: the owner opens <https://github.com/login/device>,
  types it, and approves. Then `gh auth setup-git`.
- **Name it.** A short, lowercase name for the business, like
  `acme-plumbing`: `name` in `package.json`, and `README.md`'s title and
  first paragraph.
- **The repository.** If this folder already has the business's own
  repository as `origin`, check it's private (`gh repo view --json
  visibility`), and have the owner make it private if it isn't. Otherwise:

  ```bash
  git init -b main
  git add -A && git commit -m "Set up from Superforge Foundation"
  gh repo create <name> --private --source . --push
  ```

- **Its settings.** Dependabot's alerts and security fixes, which are a
  repository's settings, not a file, then the `main` ruleset, from its
  file. On GitHub's free plan, a private repository has no rulesets: the
  script says so and passes, so tell the owner in a line and go on.

  ```bash
  gh api -X PUT "repos/{owner}/{repo}/vulnerability-alerts"
  gh api -X PUT "repos/{owner}/{repo}/automated-security-fixes"
  pnpm github:ruleset
  ```

## Two questions

1. **Where are most of the business's customers?** It picks the region,
   the nearest of Railway's four: `us-west` (California), `us-east`
   (Virginia), `europe-west` (Amsterdam), `asia-southeast` (Singapore).
   The app, its database and its buckets all run there, and the buckets
   can't move once they're made.
2. **The owner's name, and the email they'll log in with.** They go first
   in `ACCESS`'s `team` in `source/backend/auth/app.ts`, as `role:
   "owner"`, in place of Ada Lovelace. Take Grace Hopper out: the rest of
   the team comes in step 4.

Then `.railway/app.ts`: the project, named as the repository; the
repository, as `gh repo view --json nameWithOwner -q .nameWithOwner`
says; the address, `<name>.up.railway.app`, which has to be free across
all of Railway; and the region.

## Railway

Where the app runs. The owner:

1. Makes an account at <https://railway.com>, logging in with GitHub, on
   the Hobby plan, which takes a card.
2. Lets Railway's GitHub app read this repository, when Railway asks, or
   from Account Settings → GitHub.

Then you, with Railway's CLI, which `pnpm railway` runs at the version CI
uses, with nothing to install:

```bash
pnpm railway login
```

It opens the browser for the owner to approve. Then "Setting up Railway",
step 3: `pnpm railway init --name <project>`, `pnpm railway config
apply`, and the checks on recovery and tracing it gives.

## The Infra key

Production's login calls Infra with the project's secret key, which only
the app on Railway has. The owner, on superforge.studio, the project's
Setup page, makes the secret key (`sf_secret_…`, shown once), and pastes
it on Railway, in the `app` service's Variables, as `INFRA_SECRET_KEY`.
Open both pages for them. The key never goes in the chat or a file.

## The first deploy

On a branch, commit what this step changed (the names, the owner,
`.railway/app.ts`, `project_id`), and follow `commit-and-deploy.md`,
"Pull requests": push, open the PR, and watch `check`. Once it passes and
the owner says go, merge it. Railway deploys the merge once its CI run has
passed, which takes a few minutes: watch it with `pnpm railway logs`.

## The proof

- **Its domain**: once the deploy is live with the key, add the Railway
  address to the project with `add_domain`. Infra asks the app there to
  prove it's this project's, and says whether it did. Until one of the
  project's domains is proven, its key sends no login emails, and after,
  a login email links back only to a proven one.
- The owner opens `https://<name>.up.railway.app`: their home page.
- They log in at `/login` with the email they gave, with the code Infra
  emails them, from the business's name.
- `get_project` shows the secret key used.

## Railway's token, last

Until the repository has it, CI's apply skips with a notice and pushes
still deploy. With it, every merge applies `.railway/railway.ts` before
it deploys, so Railway follows the code from here on.

1. **The owner** makes a project token for the `production` environment:
   the Railway project's Settings → Tokens.
2. **The owner** saves it on GitHub as the repository secret
   `RAILWAY_TOKEN`: open
   `https://github.com/<owner>/<repository>/settings/secrets/actions/new`
   for them.
3. **You** check that the next push's `railway-apply` runs, not skips
   (`gh run view`).

## The check

The owner is logged in on the live site, and `get_project` shows the
secret key used. Then delete this file, which goes with the next commit,
and go on to `4-make-it-theirs.md`, now or in a later sitting: ask the
owner.
