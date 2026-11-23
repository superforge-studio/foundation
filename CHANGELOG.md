# Changelog

Every release of this template, newest first, a line each. Each release is
a git tag on the template's `main`, `v` and its version (`v0.9.0`), and its
notes are a file of their own, `.superforge/releases/<version>.md`.
`.superforge/superforge.json` says which release a copy is on.

`workbench/updating.md` says how a release is written and how a copy takes
one: it reads only the releases after the copy's, each from its own file.
Until 0.8.0 every release's notes were in this file, under its heading;
0.9.0 moved each to its own.

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
