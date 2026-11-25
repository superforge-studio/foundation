# Infra

Superforge Infra is the backend services this app runs on, at
`https://infra.superforge.studio/v1`. The app calls it through
[`@superforge/infra`](https://www.npmjs.com/package/@superforge/infra),
the package every app built on a Superforge template shares, which holds the
client, the stand-in and the choice between them; its README has how they
work. This folder is the app's one seam to it: a route or a workflow's
step calls `context.var.infra`, never a bare `fetch` to Infra
(`workbench/writing-code.md`, "A call to an outside service"), and the
rest of the app imports what it needs of the package from `index.ts`
here. A change to how Infra is called is a new version of the package,
which the app takes by bumping its dependency. For now Infra does three
things for the app: login for its people; keeping its comments, what its
people said about it from the toolbar; and logging Claude in to its MCP. The app's analytics isn't Infra's: its visits and
events are rows in its own database (`backend/visits/README.md`).

## Login

There's no password. A visitor proves an email address is theirs by
bringing back what Infra emailed it, and the app keeps its own users and
sessions (`backend/auth/`). Infra never keeps anyone's users, only the
codes waiting to be used. **The app's server calls Infra, never the
browser**: the key is a secret, and the pages only ever call the app's
own `/api`.

1. The visitor enters their email on `/login`. `POST /api/auth/start`
   calls Infra's `POST /v1/login/start` with it as `{ channel: "email",
   address }`, the visitor's IP (Railway's `X-Real-IP`), and `link_to`,
   this app's `/login` where the visitor is.
2. Infra emails a six-digit code, and a link to `link_to#<token>` when its
   host is one of the project's domains (or localhost), from
   `login@system.superforge.studio` under the project's name. The code and
   the link are one login: they work for 15 minutes, the code for five
   tries, and using either spends both.
3. The visitor types the code, or opens the link and presses "Finish
   logging in", which posts the token from the fragment: never as the page
   loads, so a mail scanner that opens the link spends nothing. `POST /api/auth/verify` calls Infra's
   `POST /v1/login/verify` with either (the code with its address, the
   token alone), and Infra answers whose address it was.
4. The app finds or makes the user by that email, and starts a session in
   its own Postgres (`backend/auth/login.ts`).

What the wrapper answers, and what the routes under `/api/auth` make of it:

| Infra answers                                     | The wrapper's result                   | `/api/auth` answers         |
| ------------------------------------------------- | -------------------------------------- | --------------------------- |
| 200, the email went out                           | `ok`, with `expires_at`, `test`        | 200                         |
| 429 `rate-limited`                                | `rate-limited`, `limit`, `retry_after` | 429, with `Retry-After`     |
| 502 `not-sent`, nothing counted                   | `not-sent`                             | 502                         |
| 200 `{ channel, address }`, verified              | `ok`, whose address                    | 200, the user, and a cookie |
| 400 `wrong-code`, `attempts_left`                 | `wrong-code`                           | 400                         |
| 400 `no-code` or `no-link`                        | `no-code`, `no-link`                   | 400                         |
| 401 (a key it refused), anything else, or nothing | `unavailable`, logged                  | 503                         |

A refusal is Infra's own `error`, `{ reason, message, … }`, in the same
shape as this app's API answers. `/api/auth/start` still answers the
address as `email`, so the login form reads it as before. A `retry_after`
of a minute or less is "check your inbox", which the login form says.

**Every refusal says why in words**: Infra's `message`, which says what
went wrong and what fixes it, or the package's own when Infra couldn't be
asked (no key in a build, an Infra that didn't answer, or an answer outside
its contract). The
package logs every refusal with it (`Infra refused a call`). `/api/auth`
answers the visitor the plain message alone, and adds the why as `cause`
for one of the business's own people, by the address they typed, and for
anyone on a dev server, when the email didn't go out or Infra couldn't be
asked: the login form shows it under the plain message, as "For the team:
…". A link's token names no one until Infra says whose it is, so a link
that fails tells only a dev server. So when login breaks, whoever runs the
app reads why on the login page instead of asking Claude to dig through
the logs.

Infra's limits, an hour each, per project: five emails to one address, a
minute apart; 20 from one visitor's network; 300 from the project. They
hold back abuse, not a busy day, and a refusal, `rate-limited`, says which
(`limit`: `address`, `network` or `project`) and when asking again can
work. A test key's logins have none.

## Comments: `fileComment`

Whoever's logged in gets the toolbar on every page, where Infra keeps
what's filed (`frontend/components/toolbar/`): they click an element and write what
should change, and the page posts it to the app's own `POST /api/comments`
(`backend/comments/routes.ts`), behind `loggedIn`, so a visitor can't file
one. The server adds who they are and calls
`context.var.infra.fileComment`, `POST /v1/board/comments` with the key, and
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
    user_id: user.id,
    user_name: user.first_name,
    user_agent: "Mozilla/5.0 (Macintosh; …)"
})
```

- `body`, `path`, `title`, `element` and `viewport` are the toolbar's,
  checked by `page_comment` (`utilities/schemas/comments.ts`): the
  toolbar's README has how it describes the element, and what it never
  sends.
- `user_id` is the logged-in user's ID, never their email, `user_name`
  the first name the board shows beside the note, and `user_agent` their
  `User-Agent`, for what they were on, which Infra doesn't keep.

| Infra answers                                     | The wrapper's result          | `/api/comments` answers   |
| ------------------------------------------------- | ----------------------------- | ------------------------- |
| 201 `{ comment: { id, created_at } }`             | `ok`, with `id`, `created_at` | 201, the same             |
| 400 `invalid`, the `issues` that failed           | `invalid`, `issues`, logged   | 502 `refused`: a bug here |
| 413 `too-large`                                   | `too-large`, `limit`, logged  | The same                  |
| 401 (a key it refused), anything else, or nothing | `unavailable`, logged         | 503 `unavailable`         |

Infra keeps a test key's comments too, marked as a test's, since they're
about the app as it is on someone's computer. The stand-in checks a
comment as Infra does, keeps none, and in a dev server logs each. A
comment is never sent again: one sent twice is kept twice, so the page
keeps what was written and the person saves it again.

**So the toolbar shows only where the server calls Infra itself.** It
asks `GET /api/comments/board` first (`backend/comments/board.ts`), which
answers the project the key is for, in its mode, by `project()`, Infra's
`GET /v1/project`, asked once and again a minute after a failure; or
nowhere, and why: on the stand-in (`context.var.infra_using`, "Keys",
below), with no key, with a key Infra refuses, or with an Infra that
doesn't answer, in Infra's words or the package's.

## Claude: `passOAuth`, `checkAgentToken` and the connections

Claude connects to the app's own MCP (`backend/mcp/`) as one of the
business's own people. **Infra is the OAuth server, and the app only
checks the tokens it signs**: `@superforge/infra`'s README has the flow.

- **`passOAuth`** answers Claude's OAuth calls, which
  `backend/agents/oauth.ts` hands it from
  `/.well-known/oauth-authorization-server` and `/oauth/*` (the package's
  `APP_PATHS`): the server's metadata it builds itself, naming the app's
  own addresses; the rest go to Infra's `/v1/agents/oauth/…`, with the key
  and the app's origin (`App-Origin`). Authorize sends the browser to the
  Allow page, `/connect/<request id>`, or back to Claude; a stranger is
  answered 400 in plain words, never sent anywhere. So the app's own
  domain is the issuer Claude sees, and its key never leaves the server.
- **`checkAgentToken`** checks a token Claude brings with Infra's public
  keys (`/.well-known/jwks.json` on Infra's host, fetched once and again
  for a key it doesn't have), never asking Infra: signed by Infra, for
  this origin and the address it was brought to, `/admin/mcp` (each token
  is for the address Claude asked for, so another MCP's tokens never open
  this one), for this project in the key's mode (which `GET /v1/project`
  says, asked once), and not run out. It answers whose it is, by the
  user's ID, which never changes, and what they allowed.
  `backend/auth/agents.ts` then decides whether that person is still one
  of the business's own.
- **`agentRequest`, `allowAgent` and `denyAgent`** are the Allow page's:
  what Claude asked for, and telling Infra who allowed or declined it, by
  their user's ID, which answers where the browser goes back to Claude.
- **`agentConnections`, `endAgentConnection` and `endAgentConnections`**
  are someone's Connected list, by their user's ID, and ending one, or all
  of theirs.

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

Which one the server uses is decided once, as it starts (`appInfra()` in
`index.ts`, by the package's `chooseInfra`), and every route can tell
which, from `context.var.infra_using` (`appInfraUsing()`): `"secret
key"`, `"test key"`, `"stand-in"` or `"nothing"`:

- **A build** (production, `pnpm preview`) takes only a secret key.
  Without one, or with a test key in its place, every login answers 503
  and the logs say `Login is down`, with why, which the team sees on the
  login page too. It never falls back to the stand-in, which would show
  anyone's code on the page.
- **A dev server** takes only a test key, from the shell or the checkout's
  `.env`, so it can't email real people. A git worktree with no `.env` of
  its own reads its main checkout's, so the key is set once per computer.
- **A dev server with no test key**, as right after a clone, uses the
  stand-in (the package's `standInInfra`): Infra's test mode in memory,
  with nothing to set up. Logging in works the same, without Infra, but
  the toolbar doesn't show, since nothing keeps a comment.
- **The tests** always use the stand-in (`backend/tests/support/api.ts`),
  so they never reach Infra, and say so (`infra_using`); a test of what a
  key changes gives its own (`testApi({ infra, infra_using: "test key" })`).

A build always calls Infra at its own address. Only a dev server reads
`INFRA_URL`, which points it at another Infra's address. A copy never
needs it.

## In this folder

- `index.ts`: `appInfra()`, the server's Infra, `appInfraUsing()`, which
  one it is, and what the rest of the
  app uses of `@superforge/infra`: `Infra` and its results, the stand-in
  and `standInAgentToken` for the tests, `requestOrigin`, `APP_PATHS` and
  `OAUTH_CALLS` for Claude's login, and `infraClient`. Everything else,
  the client, Infra's contract (at `@superforge/infra/contract`, which
  `utilities/schemas/agents.ts` takes Claude's scopes from, building its
  own schema of them with the app's zod), the stand-in and choosing
  between them, is the package's. The package brings its own zod, so the
  app's can be any version; its schemas are never put inside the app's.

To check a key from a terminal, `GET /v1/project` answers its project and
its mode, `live` or `test`:

```bash
curl -H "Authorization: Bearer $INFRA_SECRET_KEY" https://infra.superforge.studio/v1/project
```
