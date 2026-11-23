# Infra

Superforge Infra is the backend services this app runs on, at
`https://infra.superforge.studio/v1`. This folder is the one wrapper the
app calls it through: a route or a workflow's step calls
`context.var.infra`, never a bare `fetch` to Infra
(`workbench/writing-code.md`, "A call to an outside service"). For now
Infra does three things for the app: login for its people; keeping its
comments, what its people said about it from the toolbar; and logging
Claude in to its MCP. The app's analytics isn't Infra's: its visits and
events are rows in its own database (`backend/visits/README.md`).

## Login

There's no password. A visitor proves an email address is theirs by
bringing back what Infra emailed it, and the app keeps its own users and
sessions (`backend/auth/`). Infra never keeps anyone's users, only the
codes waiting to be used. **The app's server calls Infra, never the
browser**: the key is a secret, and the pages only ever call the app's
own `/api`.

1. The visitor enters their email on `/login`. `POST /api/auth/start`
   calls Infra's `POST /v1/login/start` with it, the visitor's IP
   (Railway's `X-Real-IP`) and the app's origin.
2. Infra emails a six-digit code, and a link back to the app's
   `/login#<token>` when the origin is one of the project's domains (or
   localhost), from `login@system.superforge.studio` under the project's
   name. A code and a link each work once, for 15 minutes, and a code for
   five tries.
3. The visitor types the code, or opens the link and presses "Finish
   logging in", which posts the token from the fragment: never as the page
   loads, so a mail scanner that opens the link spends nothing. `POST /api/auth/verify` calls Infra's
   `POST /v1/login/verify` with either, and Infra answers the email.
4. The app finds or makes the user by that email, and starts a session in
   its own Postgres (`backend/auth/login.ts`).

What the wrapper answers, and what the routes under `/api/auth` make of it:

| Infra answers                                     | The wrapper's result               | `/api/auth` answers         |
| ------------------------------------------------- | ---------------------------------- | --------------------------- |
| 200, the email went out                           | `ok`, with `expires_at`, `test`    | 200                         |
| 429 `too-soon`, a minute apart                    | `too-soon`, `retry_after`          | 429, with `Retry-After`     |
| 429 `too-many`, an hour's limit                   | `too-many`, `limit`, `retry_after` | 429, with `Retry-After`     |
| 502 `not-sent`, nothing counted                   | `not-sent`                         | 502                         |
| 200 `{ email }`, verified                         | `ok`, the email                    | 200, the user, and a cookie |
| 400 `wrong-code`, `attempts_left`                 | `wrong-code`                       | 400                         |
| 400 `no-code` or `no-link`                        | `no-code`, `no-link`               | 400                         |
| 401 (a key it refused), anything else, or nothing | `unavailable`, logged              | 503                         |

Infra's limits, an hour each, per project: five emails to one address, a
minute apart; 20 from one visitor's network; 300 from the project. They
hold back abuse, not a busy day, and a refusal says when asking again can
work. A test key's logins have none.

## Comments: `fileComment`

Whoever's logged in gets the toolbar on every page
(`frontend/components/toolbar/`): they click an element and write what
should change, and the page posts it to the app's own `POST /api/comments`
(`backend/comments/routes.ts`), behind `loggedIn`, so a visitor can't file
one. The server adds who they are and calls
`context.var.infra.fileComment`, `POST /v1/comments` with the key, and
Infra keeps it for the owner and their agents to act on:

```ts
context.var.infra.fileComment({
    body: "This button sits too close to the edge on a phone",
    path: "/pricing",
    title: "Pricing",
    element: {
        selector: "body > div > main > section:nth-of-type(2) > a",
        tag: "a",
        text: "Book a call",
        classes: "inline-flex rounded-md bg-primary px-4",
        box: { x: 120, y: 1640, width: 180, height: 44 }
    },
    viewport: { width: 1440, height: 900 },
    user: user.id,
    user_agent: "Mozilla/5.0 (Macintosh; …)"
})
```

- `body`, `path`, `title`, `element` and `viewport` are the toolbar's,
  checked by `page_comment` (`utilities/schemas/comments.ts`): the
  toolbar's README has how it describes the element, and what it never
  sends.
- `user` is the logged-in user's ID, never their email, and `user_agent`
  their `User-Agent`, for what they were on, which Infra doesn't keep.

| Infra answers                                     | The wrapper's result          | `/api/comments` answers   |
| ------------------------------------------------- | ----------------------------- | ------------------------- |
| 201 `{ comment: { id, created_at } }`             | `ok`, with `id`, `created_at` | 201, the same             |
| 400 `invalid`, the `fields` that failed           | `invalid`, `fields`, logged   | 502 `refused`: a bug here |
| 413 `too-large`                                   | `too-large`, `limit`, logged  | The same                  |
| 401 (a key it refused), anything else, or nothing | `unavailable`, logged         | 503 `unavailable`         |

Infra keeps a test key's comments too, marked as a test's, since they're
about the app as it is on someone's computer. The stand-in checks a
comment as Infra does, keeps none, and in a dev server logs each. A
comment is never sent again: one sent twice is kept twice, so the page
keeps what was written and the person saves it again.

## Claude: `passOAuth`, `checkAgentToken` and the connections

Claude connects to the app's own MCP (`backend/mcp/`) as one of the
business's own people. **Infra is the OAuth server, and the app only
checks the tokens it signs**: Infra's README, "Claude", has the flow.

- **`passOAuth`** passes Claude's OAuth calls through, as they are, to
  Infra's `/v1/oauth/…`, with the key and the app's origin
  (`App-Origin`), and answers Infra's answer as it is: its status, its
  body, and where it sends the browser. `backend/agents/oauth.ts` calls it
  for `/.well-known/oauth-authorization-server` and `/oauth/*`. So the
  app's own domain is the issuer Claude sees, and its key never leaves
  the server.
- **`checkAgentToken`** checks a token Claude brings with Infra's public
  keys (`/.well-known/jwks.json` on Infra's host, fetched once and again
  for a key it doesn't have), never asking Infra: signed by Infra, for
  this origin and its `/admin/mcp`, for this project in the key's mode (which
  `GET /v1/project` says, asked once), and not run out. It answers whose
  address it is and what they allowed. `backend/auth/agents.ts` then
  decides whether that person is still one of the business's own.
- **`agentRequest`, `allowAgent` and `denyAgent`** are the Allow page's:
  what Claude asked for, and telling Infra who allowed or declined it,
  which answers where the browser goes back to Claude.
- **`agentConnections`, `endAgentConnection` and `endAgentConnections`**
  are someone's Connected list, and ending one, or all of theirs.

A token is bound to where it was made: an app's origin, and its project
in a mode. A test key's tokens are only ever for this computer, so a dev
server connects Claude with a test key; the stand-in logs nobody in,
and checks only what `standInAgentToken` mints, for the tests.

## Keys

Each copy of this codebase is a **project** on Infra, made on
superforge.studio's dashboard (the Infra tab), which also lists the
**domains** its login links may go to: add the app's Railway address
and its custom domain there. A project has two kinds of key, each shown
once as it's made:

| Key                       | Where it goes                                                              | Its logins                                                   |
| ------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Secret key, `sf_secret_…` | `INFRA_SECRET_KEY` on the app's service in Railway (`.railway/railway.ts`) | sent by email, for real                                      |
| Test key, `sf_test_…`     | `INFRA_TEST_KEY` in the checkout's `.env` (`.env.example`)                 | not sent: Infra answers the code, which the dev server shows |

A test key's comments are kept, marked as a test's.

Which one the server uses is decided once, as it starts (`choose.ts`):

- **A build** (production, `pnpm preview`) takes only a secret key.
  Without one, or with a test key in its place, every login answers 503
  and the logs say `Login is down`. It never falls back to the stand-in,
  which would show anyone's code on the page.
- **A dev server** takes only a test key, from the shell or the checkout's
  `.env`, so it can't email real people. A git worktree with no `.env` of
  its own reads its main checkout's, so the key is set once per computer.
- **A dev server with no test key**, as right after a clone, uses the
  stand-in (`stand-in.ts`): Infra's test mode in memory, with nothing to
  set up. Logging in works the same, without Infra.
- **The tests** always use the stand-in (`backend/tests/support/api.ts`),
  so they never reach Infra.

`INFRA_URL` points the server at another Infra, like a Superforge
checkout's own dev server (`http://infra.localhost:3002/v1`), to work on
both at once; without it, the server calls the real one (`INFRA_URL` in
`client.ts`).

## In this folder

- `index.ts`: `Infra`, what the app asks of it, its results, and
  `appInfra()`, the server's.
- `agents.ts`: Claude's login: where a request reached the app
  (`requestOrigin`), passing an OAuth call through, what Infra answers
  about requests and connections, and checking a token with `jose`.
- `answers.ts`: what Infra answers, as zod schemas, which `index.ts`'s
  types come from.
- `comments.ts`: a comment from the toolbar, with who filed it, checked
  as Infra checks it.
- `client.ts`: Infra over HTTP with a key, its answers parsed with them.
  No call is retried: a second start would send a second email, and a
  comment sent again is kept twice.
- `stand-in.ts`: Infra's test mode, in memory, which checks a comment and
  keeps none.
- `choose.ts`: which of them the server uses, and reading a checkout's
  `.env`.

To check a key from a terminal, `GET /v1/project` answers its project and
its mode, `live` or `test`:

```bash
curl -H "Authorization: Bearer $INFRA_SECRET_KEY" https://infra.superforge.studio/v1/project
```
