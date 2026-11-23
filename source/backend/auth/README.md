# Logging in

Who's logged in, and what they may do. There's no password: Superforge
Infra emails an address a code and a link, and says whose address it is
when either comes back (`backend/infra/README.md`, "Login", has Infra's
side: how long they work, its limits and its keys). The app keeps the
rest: its users, their sessions, and the one place that decides who a
request is from, `logged-in.ts`. **Only the team logs in**, as `access.ts`
lists them. `workbench/writing-code.md`, "The team and what each role may
do", has that rule, the roles and the areas; this guide has how it's
carried out.

## The routes

`routes.ts`, under `/api/auth`. Anyone may call all four, since they're
how someone comes to be logged in:

| Route                   | Who may call it                               | What it answers                                                                       |
| ----------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------- |
| `GET /api/auth/session` | Anyone (`maybeLoggedIn`)                      | `{ user, permissions }`, each null for a visitor, with whatever `OTHERS.session` adds |
| `POST /api/auth/start`  | Anyone, with `{ email }`                      | `{ email, with_link, expires_at, development }` once the email is out, or a refusal   |
| `POST /api/auth/verify` | Anyone, with `{ email, code }` or `{ token }` | `{ user, permissions }` and the `session` cookie, or a refusal                        |
| `POST /api/auth/logout` | Anyone, with no body                          | `{ logged_out: true }`, with this browser's session ended and its cookie cleared      |

The last three are in `ANYONE` (`backend/tests/routes.test.ts`), with why
each may be. The pages call them through `frontend/queries/auth.ts`, whose
`useSession()` is how a screen knows who's logged in.

## A login, from the page to the session

1. **The address.** The login page (`frontend/routes/login.tsx`, with
   `components/site/login-form.tsx`) posts `{ email }` to `/auth/start`.
   `login_start` (`utilities/schemas/auth.ts`) trims and lowercases it, so
   one person is one address however it's typed.
2. **Who may.** `mayLogIn` (`login.ts`) looks the address up in
   `context.var.access`, and only one the team doesn't have is asked of
   `OTHERS.mayLogIn` (below). Anyone else is refused here, before Infra is
   asked, so nothing is emailed to a stranger.
3. **The email.** `context.var.infra.startLogin`, with the address, the
   visitor's IP address (`visitorIp`, from Railway's `X-Real-IP`), which
   Infra's limits count by, and `link_to`, this request's own origin with
   `/login`. Infra emails a six-digit code, and a link to
   `/login#<token>` when that origin is one of the project's domains, or
   localhost. The route answers the address as Infra keeps it, whether
   the email holds a link, and when the two stop working.
   `development` is the code and the link themselves, for the page to
   show, in a dev server only (`import.meta.env.DEV`): a build answers
   null there whatever Infra said.
4. **The proof.** `/auth/verify` takes the code with its address, or the
   link's token, which the page takes from the link's fragment and posts
   only once the visitor presses "Finish logging in". So the token stays
   out of addresses and logs, and a mail scanner that opens the link
   spends nothing. Infra answers whose address it was.
5. **The row and the session**, in one transaction (`logIn`, `login.ts`):
   the person's row is made to follow the list (`keepListed`, below),
   `logged_in_at` is set, and `startSession` ends the session this browser
   had, deletes their sessions that have run out, and inserts the new one.
6. **The cookie.** `setSessionCookie`, then `OTHERS.logOut` for the token
   the browser held before, in case it was someone else's. `Logged in` is
   logged with the user's ID, and the answer is the user, with the names
   and role the list gives them, and what that role may do in each area.

### What each refusal is

| Route         | Status | `reason`       | When                                                             | Beside the message                             |
| ------------- | ------ | -------------- | ---------------------------------------------------------------- | ---------------------------------------------- |
| start, verify | 400    | `invalid`      | The body isn't an address, a six-digit code or a link's token    | `issues`                                       |
| start         | 403    | `not-listed`   | The address isn't the team's, and nothing else lets it in        |                                                |
| start         | 429    | `rate-limited` | One of Infra's limits                                            | `retry_after`, `limit`, a `Retry-After` header |
| start         | 502    | `not-sent`     | The email didn't go out, and nothing was counted                 | `cause`, for the team                          |
| start, verify | 503    | `unavailable`  | Infra refused the key, didn't answer, or answered something else | `cause`, for the team                          |
| verify        | 400    | `wrong-code`   | That isn't the code                                              | `attempts_left`                                |
| verify        | 400    | `no-code`      | There's no code to try for that address                          |                                                |
| verify        | 400    | `no-link`      | The link has run out or was used                                 |                                                |
| verify        | 403    | `not-listed`   | Infra said whose address it is, and the list doesn't have it now |                                                |

**`cause` is why, in Infra's words or its package's**, for whoever can act
on it (`forTheTeam`, `routes.ts`): someone whose typed address the list
has, or anyone on a dev server. A visitor gets the plain message alone,
since the cause can name the app's keys and settings. A link's token names
no one until Infra says whose it is, so a link that fails tells only a dev
server. The second `not-listed` is `NO_ONE_ELSE`'s: an app that lets
someone else in answers whatever its own hook does there (below).

## The session and its cookie

**A session is a row in `auth.sessions`** (`sessions.ts`), keyed by the
SHA-256 of its token. The token is 32 random bytes (`randomToken`,
`tokens.ts`), which only the browser's cookie holds, so a row that leaks
logs no one in. Its `user_agent` is the browser as it described itself,
cut to 512 characters (`visitorBrowser`, `visitor.ts`), which the account
page shows back to its own person.

- **The cookie** is `session`: `HttpOnly`, `SameSite=Lax`, `Path=/`, for
  30 days, and `Secure` everywhere but plain http on this computer or a
  dev server (`secureCookie`, `logged-in.ts`). Behind Railway's proxy a
  request's own address says http, so the protocol alone can't decide it.
- **It lasts 30 days from when it was last renewed** (`SESSION_LIFETIME`).
  A request that comes through `loggedIn`, `permitted` or `maybeLoggedIn`
  renews a session last renewed over a day ago (`RENEW_EVERY`): the same
  token, 30 days again, and the cookie set again once the route has
  answered. So someone who comes back within 30 days never logs in again,
  and a session costs the table one write a day at most. Of the requests
  a page makes at once, one renews (`renewSession` says whether it did).
- **Outside `sessions.ts` a session goes by its ID**, the first 16
  characters of its token's hash (`sessionId`): enough to tell someone's
  sessions apart, and nothing a browser can log in with. The account's
  routes list and end them by it (`backend/account/routes.ts`).

What ends one:

| What happens                                   | What the code does                                                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/auth/logout`                        | Deletes the row (`endSession`) and clears the cookie                                                                      |
| The same browser logs in again                 | `startSession` deletes the one it had (`replacing`)                                                                       |
| Its person logs a browser out on their account | `endSessionById`, or `endOtherSessions` for every one but the one they're using                                           |
| 30 days pass without a request                 | Nothing deletes it then: `liveSession` stops finding it, and it goes at its person's next login, or with `prune-sessions` |
| Its person is taken off the list               | It stops counting at their next request (`currentSession`), and the next sync deletes it                                  |
| Its person's row is deactivated, or deleted    | `liveSession` leaves out a deactivated person's, and a deleted row's sessions go with it (`on delete cascade`)            |

## The team, in code and in `users`

`access.ts` holds the list, `ACCESS`, with each role's grant, and what
reads it: `listedInternal` (by address, trimmed and lowercased),
`listedBySlug`, `roleOf` (a `member` when the role is left out),
`permissionsOf(access, role)` and `problemsWith`. Every route and
middleware reads it from `context.var.access`, never `ACCESS` itself, so a
test hands its own.

- **A logged-in person is a `TeamMember`** (`sessions.ts`): their row's
  `id`, `slug`, `email`, `name` and `created_at` (`TEAM_ROW_COLUMNS`),
  with the `name`, `first_name`, `last_name` and `role` the list gives
  them (`listing()`), which the middleware adds on every request. `users`
  has no column for a role. So a name or a role changed in `access.ts`
  holds from the first request after the deploy, whatever the row says.
- **`keepListed`** (`../users/sync.ts`) makes one person's row follow the
  list, inside a transaction: found by their slug, or, for a row from
  before slugs, by their address, which then takes the slug. It sets the
  slug, the address and the name, and clears `deactivated_at`. A row it
  has to make queues `user-added`, named for the user, in the same
  transaction, so `tell-team-of-new-member` runs once for them
  (`backend/workflows/README.md`, "The sample").
- **`syncInternalUsers`** does that for everyone listed, deactivates
  everyone else (`deactivated_at`), and deletes the sessions of every
  deactivated person, in one transaction. It throws on a list with a
  mistake in it (`problemsWith`: a slug that isn't one, or a slug or an
  address listed twice), changing nothing. `syncAppInternalUsers` runs it
  with `ACCESS` once the Node server is listening (`source/node.ts`), and
  as a dev server first loads `source/server.ts`; never in the build's
  prerender or the tests. It never rejects: it logs how many it made and
  deactivated (`The team follows access.ts`), or that it failed
  (`The team didn't sync with access.ts`), and the server goes on.
- **The list decides, not the sync.** The middleware counts someone only
  while `listedBySlug` finds their row's slug, so the sync is what keeps
  the database telling the same story, not what keeps anyone out. A list
  with a mistake still decides who logs in; `pnpm check` is what catches
  one (`../users/tests/sync.test.ts`, which also holds `ACCESS` to an
  owner who may do everything).
- **Taking someone off deletes only their sessions.** Their row stays,
  and so do their API tokens' rows, and Claude's connections, which
  Infra keeps. Both kinds of token are refused while their person is off
  the list or deactivated, and count again once they're listed again with
  the same slug and their row is active, if the token hasn't run out or
  been revoked meanwhile.

## The four checks

Every route under `/api` takes one of the first three (`logged-in.ts`),
or is listed in `ANYONE`, which a test holds it to; "A route that needs
the user" in `workbench/writing-code.md` says which. Nothing else decides
who a request is from.

| Check                     | Lets through                                                                                 | Puts on `context.var`                                        | Refuses with                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `permitted(area, level?)` | Someone whose role reaches the level in the area; with a token, only as far as its scopes do | `user`, `session`, `logged_in_with`, `scopes`, `permissions` | 401 `logged-out`, 403 `not-permitted` with `area` and `level`, 403 `read-only` |
| `loggedIn`                | Anyone on the team                                                                           | The same five                                                | 401 `logged-out`, 403 `read-only`                                              |
| `maybeLoggedIn`           | Everyone                                                                                     | `user` and `permissions`, each null for a visitor            | Nothing                                                                        |
| `inBrowser`               | After one of the first two, only a browser's session                                         | Nothing                                                      | 403 `browser-only`                                                             |

- **Who's asking is worked out the same way for all of them**
  (`whoIsAsking`). An `Authorization: Bearer` header comes first: a token
  that starts `api_` is an API token's, and any other is taken for
  Claude's. A request with a token is the token's whatever cookie it
  carries, so one with a bad token is nobody's, even beside a good cookie.
  Without the header, it's the `session` cookie.
- **`user`** is the `TeamMember`. **`session`** is `{ id }`: a browser's
  session's ID, or `agent` or `api-token` for a token, which no session's
  ID ever is. **`logged_in_with`** is `session`, `agent` or `token`.
  **`scopes`** is what the request was let do: both `read` and `act` for a
  browser, and what a token was given.
- **`permitted` checks the person, then the token.** A `GET` or a `HEAD`
  needs `read` and anything else `write` (`levelFor`), unless the route
  says. A role that doesn't reach it is `not-permitted`, whatever asked.
  A token whose person's role does, but which wasn't given enough, is
  `read-only`. `permissions` is the role's for a browser, and for a token
  the lower of the role's and what it was given, area by area
  (`permissionsFor`).
- **`loggedIn` holds a token to its scopes by the method alone**: with
  only `read`, a token makes `GET` and `HEAD` requests (`mayDo`).
- **`maybeLoggedIn` refuses nothing**: a token with only `read` gets
  through a `POST` behind it, as its person, with `permissions` saying
  what it may do. It sets no `session`, `logged_in_with` or `scopes`.
- **`inBrowser` is for what a token must never do**: see where someone is
  logged in or log a browser out, see Claude's connections, end one or
  allow Claude in, and make, list or revoke API tokens. So a token that
  leaks can't make itself another, or lock anyone out.
- **`requirementOf(handler)`** answers a `permitted` middleware's area
  and level. The test that every route says who may call it reads it, and
  so does the MCP's `list_routes`.

## A token in a cookie's place

Two kinds, each acting as one of the team, each sent as
`Authorization: Bearer`:

- **Claude's** (`agents.ts`) is an access token Infra signed when someone
  allowed Claude in on the Allow page (`backend/mcp/README.md`).
  `infra.checkAgentToken` checks it with Infra's public keys: signed by
  Infra, for this origin and for `/admin/mcp`. It answers the user's ID,
  the scopes and the connection's ID. `agentUser` then finds that user's
  row, not deactivated, and their slug on the list. A token Infra signed
  whose person fails that is logged, with the connection's ID
  (`Agent token for someone not on the team`).
- **An API token** (`api-tokens.ts`) is one a person made on their account
  page for a script: `api_`, then 43 letters and digits. Its row in
  `auth.api_tokens` keeps its SHA-256, its last four characters
  (`preview`), its name, its scopes, and when it runs out, if it does: 30,
  90 or 365 days (`API_TOKEN_LIFETIMES`, `utilities/schemas/api-tokens.ts`),
  or never. `makeApiToken` answers the token itself, and nothing shows it
  again. `apiTokenUser` refuses one that isn't shaped like a token before
  it costs a query, then one that has run out, or whose person is
  deactivated or off the list, and notes `last_used_at`, at most once a
  minute. Revoking deletes the row. A token that has run out stays listed
  until it's revoked, so a script that stopped working says why. Its
  routes are the account's (`backend/account/routes.ts`), each behind
  `inBrowser`.

**Each is narrowed three ways.** By its person's role, which it never
passes. By its scopes: `read` reads every area the role reads, and `act`
changes what the role may change. And by `inBrowser`, which no scope gets
past. `workbench/writing-code.md`, "The team and what each role may do",
has the rule.

## Someone besides the team

`others.ts` and `app.ts` are the one place for a second kind of person to
log in, like a customer or a member. `OTHERS` (`app.ts`, the app's own
file) is `NO_ONE_ELSE` as the template ships: no other address may start,
a verified address that isn't the team's is refused 403 `not-listed`, the
session's answer gains nothing, and logging out ends nothing more. An app
names its own there, made with `otherLogins({ … })`, from the feature that
keeps those people.

**The team always comes first**: an address the list has logs in as one of
the team, and only one it doesn't have is asked of these four:

| Hook                       | Asked                                                                                                                        | It answers                                                                                                                 |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `mayLogIn(context, email)` | By `/auth/start`, of an address the team doesn't have, before Infra is asked                                                 | Whether Infra may email it                                                                                                 |
| `logIn(context, email)`    | By `/auth/verify`, once Infra has said whose the address is and the list doesn't have it                                     | The route's whole answer: it starts their session, sets the cookie (`setSessionCookie`), and says who they are, or refuses |
| `session(context)`         | By every `GET /auth/session`                                                                                                 | What's spread into the answer beside `user` and `permissions`, like `{ customer }`, or nobody                              |
| `logOut(context, token)`   | By `/auth/logout`, with the cookie's token, and by `/auth/verify` once one of the team is in, with the token the browser had | Nothing: it ends the session behind the token, if it's one of theirs                                                       |

- **They share the login page, the code and the link Infra emails, and
  the `session` cookie**, whose token is looked for among the team's
  sessions first.
- **`otherLogins` keeps what each hook answers in its type**, so the
  typed client knows what `/auth/verify` and `/auth/session` can answer.
- **What stays the team's alone**: `logIn`, `auth.sessions`, `loggedIn`,
  `permitted`, `inBrowser`, both kinds of token and the account's routes.
  `maybeLoggedIn` answers `user: null` for one of them. Their sessions
  are in a table of their feature's own, and a route of theirs takes a
  check of that feature's own, which reads the same cookie
  (`sessionToken`) and tells the routes' test it says who may call
  (`appSaysWhoMayCall`, `backend/tests/support/app.ts`).
- **Nothing ends a team member's session when someone else logs in over
  it**: `logIn` answers `not-listed` before it starts anything. The hook's
  cookie replaces the browser's, and the team's row stays until it runs
  out, unless the hook ends it (`endSession`).

## The `prune-sessions` job

`jobs.ts` is the template's example of a job (`backend/jobs/README.md`),
listed in `backend/jobs/index.ts`. A login deletes its own person's
sessions that have run out, so what's left are those of people who never
came back, rows no request accepts. Its dry run counts them
(`countExpiredSessions`), and its run deletes them 500 at a time
(`deleteExpiredSessions`), a step each, `delete-batch-<n>`, until a batch
comes back short, and answers `{ deleted }`. Nothing runs it on a
schedule: someone starts it with `POST /api/jobs/prune-sessions`, after
its dry run.

## In a test

- **`testApi()` starts with no one on the team**, whatever `ACCESS` lists,
  each role with what this app gives it (`backend/tests/support/api.ts`).
  `testApi({ access })` hands a team, with its own `roles` to test one.
- **`logInAs(api, email, role)`** (`backend/tests/support/login.ts`) lists
  the address first, unless it's listed, as an `owner` unless it says
  (`ada@example.com` is Ada Example, slug `ada`), then logs it in through
  `/auth/start` and `/auth/verify` with the stand-in's code. It answers
  the user's `id` and the `cookie` header to send:
  `client.api.users.$get({}, { headers: { cookie } })`.
- **`api.internal_users` is the list the API reads**, so
  `api.internal_users.splice(0)` takes everyone off it between two
  requests, as `tests/routes.test.ts` here does.
- **A token**: an API token made through `client.api.account.tokens.$post`
  with the cookie, as `tests/api-tokens.test.ts` does, or Claude's from
  `standInAgentToken` (`backend/infra`), as
  `backend/agents/tests/agents.test.ts` does.
- **A check by itself**: a Hono app of the test's own, with `database` and
  `access` set on its context and a route behind the check.
- **Time**: every comparison is against the database's clock, so a test
  moves a row's `expires_at` with `fromNow` rather than faking the
  server's. `vi.stubEnv("DEV", false)` makes the routes answer as a build
  does.

## In this folder

- `routes.ts`: the four routes.
- `login.ts`: `mayLogIn` and `logIn`.
- `sessions.ts`: the sessions' operations, with `TeamRow` and
  `TeamMember`.
- `logged-in.ts`: the cookie and the four checks.
- `access.ts`: `ACCESS`, the team and its roles, which START-HERE.md sets.
- `agents.ts` and `api-tokens.ts`: the two kinds of token.
- `others.ts` and `app.ts`: whoever else logs in.
- `jobs.ts`: `prune-sessions`.
- `tokens.ts`: `randomToken`, `randomCharacters` and `sha256`.
- `visitor.ts`: what's read of a request: `visitorIp`, `visitorBrowser`,
  `visitorUserAgent` and `appOrigin`, which the analytics and the
  comments read too.
