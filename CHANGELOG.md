# Changelog

Every release of this template, newest first, a line each. Each release is
a git tag on the template's `main`, `v` and its version (`v0.9.0`), and its
notes are a file of their own, `.superforge/releases/<version>.md`.
`.superforge/superforge.json` says which release a copy is on.

`workbench/updating.md` says how a release is written and how a copy takes
one: it reads only the releases after the copy's, each from its own file.
Until 0.8.0 every release's notes were in this file, under its heading;
0.9.0 moved each to its own.

- [0.21.1](.superforge/releases/0.21.1.md) (2026-11-23): guides for logging in, Your files and the database, each a README in its folder, and a few comments put right.
- [0.21.0](.superforge/releases/0.21.0.md) (2026-11-23): a file has one owner, the template or the app: an `app.ts` beside each list the template keeps holds the app's own tables, routes, workflows, seeders, kinds of file and areas, and login has one place for someone besides the team to log in, so an update stops meeting what a business added.
- [0.20.1](.superforge/releases/0.20.1.md) (2026-11-23): `writing-code.md` says a column still in `schema.ts` is one the running code names, so dropping it takes two deploys, and how a copy takes 0.19.0's drop of `users.role` without breaking the version still serving.
- [0.20.0](.superforge/releases/0.20.0.md) (2026-11-23): on `@superforge/infra` 0.3.0, Infra's v1 API, which a copy has to take when Infra moves to it: login sends a channel, an address and the page its link opens, `rate-limited` replaces `too-soon` and `too-many`, comments and Claude's connections name their person by user ID, and a build never reads `INFRA_URL`.
- [0.19.0](.superforge/releases/0.19.0.md) (2026-11-23): the team's own files, in folders in the bucket, with an API to upload, sort, share and delete them, a rate limiter by network for routes anyone may call, and `users.role` dropped.
- [0.18.1](.superforge/releases/0.18.1.md) (2026-11-23): the smoke test waits for the server itself to stop, not just pnpm, so its traces check no longer fails at random on CI.
- [0.18.0](.superforge/releases/0.18.0.md) (2026-11-23): only the team logs in, each role may do what the code gives it in each area of the app, checked on every route, Claude and API tokens never more than their person, and the dashboard is `/admin`, its 404s in its frame.
- [0.17.0](.superforge/releases/0.17.0.md) (2026-11-23): a remembered visitor's IP address is kept again, on their visit, for 90 days; a visitor the site doesn't remember still has none kept.
- [0.16.0](.superforge/releases/0.16.0.md) (2026-11-23): every page credits the Superforge template it was built on in its source, a `<meta name="generator">`, never on the page.
- [0.15.0](.superforge/releases/0.15.0.md) (2026-11-23): API tokens, which one of the business's own makes on their account page, so a script, a scheduled job or another platform's agent calls the app's API, and its MCP, as them.
- [0.14.0](.superforge/releases/0.14.0.md) (2026-11-23): Infra through `@superforge/infra`, an npm package every app shares; the login page tells the business's own people why login broke, in Infra's words; and `AsyncOperation` is `AsyncOperationResult`.
- [0.13.0](.superforge/releases/0.13.0.md) (2026-11-22): "log in" and "login", never "sign in": the login page at `/login`, and Infra's new login calls, which a copy needs to log anyone in.
- [0.12.0](.superforge/releases/0.12.0.md) (2026-11-22): runs queued inside a write's own transaction, workflows on events and on cron schedules, quiet workflows, and webhooks in at `/api/webhooks/<source>`.
- [0.11.0](.superforge/releases/0.11.0.md) (2026-11-22): the app traces itself into Railway: every request by its route, every query and call out, each workflow run and step, and its logs on them.
- [0.10.1](.superforge/releases/0.10.1.md) (2026-11-22): every PR to the template is a release, a small improvement is a patch, and CI checks each PR takes the next version.
- [0.10.0](.superforge/releases/0.10.0.md) (2026-11-22): every request nothing answers, and every one that fails, logged, and a page sent a POST refused.
- [0.9.0](.superforge/releases/0.9.0.md) (2026-11-22): each release's notes in a file of its own, and this file their index.
- [0.8.0](.superforge/releases/0.8.0.md) (2026-11-21): the app's MCP moves to `/admin/mcp`, leaving `/mcp` for the business's customers.
- [0.7.0](.superforge/releases/0.7.0.md) (2026-11-21): analytics of the app's own, in its own Postgres, with Infra no part of them.
- [0.6.0](.superforge/releases/0.6.0.md) (2026-11-21): jobs, changes to the app's data started on purpose, a dry run first.
- [0.5.0](.superforge/releases/0.5.0.md) (2026-11-21): Claude connected to the app, through an MCP of its own, signed in through Infra.
- [0.4.0](.superforge/releases/0.4.0.md) (2026-11-18): what visitors do on the site, kept by Infra for the owner's dashboard.
- [0.3.0](.superforge/releases/0.3.0.md) (2026-11-16): the dashboard, behind sign-in, with a role for everyone who signs in.
- [0.2.0](.superforge/releases/0.2.0.md) (2026-11-15): sign-in, through Superforge Infra.
- [0.1.0](.superforge/releases/0.1.0.md) (2026-11-15): the first release.
