# The app's MCP

An MCP server at the app's own `/admin/mcp`, so Claude, on a laptop, in a
cloud session or in claude.ai, can read the app's data and work in it as
one of the business's own people. It's MCP's Streamable HTTP without
sessions: each request gets a server of its own and a plain JSON answer,
so a deploy loses nothing.

**Why `/admin/mcp`, not `/mcp`.** This MCP is the admin's: it's for the
business's own people, as the admin is, so it sits under `/admin`. `/mcp`
is left free on purpose, for an MCP the business may one day give its
customers, logged in as one of them, with tools of its own and tokens of
its own. Infra signs each token for one MCP's path, so the two never open
each other. Until a business builds one, `/mcp` answers nothing, and
Infra logs Claude in to `/admin/mcp` alone. The path is `MCP_PATH`
(`utilities/schemas/agents.ts`), which everything that names it reads.

## How Claude connects

**Nobody sets anything up, or pastes a token.** Add the app's
`https://<its domain>/admin/mcp` to Claude once: as a connector on claude.ai
(Settings, Connectors), which reaches claude.ai, the desktop app, cloud
sessions and scheduled tasks, or in Claude Code. Then:

1. Claude calls `/admin/mcp` and is told to log in: a 401 with
   `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource/admin/mcp"`.
2. Claude reads where to log in, the app itself
   (`backend/agents/oauth.ts`), and opens the browser at the app's
   `/oauth/authorize`, which Superforge Infra answers through the app.
3. The browser lands on the app's own Allow page, `/connect/<id>`. Someone
   on the team logs in there if they aren't already, and allows Claude
   to read, or to read and act.
4. Claude gets a token Infra signed, and refreshes it on its own, so they
   log in once. Their account page lists the connection, and Disconnect
   ends it within ten minutes.

A dev server connects the same way with an Infra test key
(`INFRA_TEST_KEY`), at `http://localhost:3000/admin/mcp`. Without one, the
stand-in can't log Claude in.

### Without a browser: an API token

Logging in this way needs a person to click Allow in a browser. What
can't, like a script, a scheduled job or another platform's agent, calls
the API under `/api` with an API token instead: someone on the team makes
one on their account page, named, to read or to read and act, lasting
until it's revoked or for 30, 90 or 365 days, and it's shown once. It's
sent as `Authorization: Bearer api_…`, in place of Claude's token, acts as
the person who made it, with the same `read` and `act`, and is refused by
`inBrowser` as Claude's is. Only its SHA-256 is kept, in `auth.api_tokens`
(`backend/auth/api-tokens.ts`); the account page lists each with when it
was last used, and Revoke ends it at once.

```bash
curl -H "Authorization: Bearer $API_TOKEN" https://<its domain>/api/users
```

`/admin/mcp` takes one too, for an agent whose MCP client sends a header
it's given rather than logging in: the MCP asks the API who a token logs
in, and its tools call the API with it, so it does there what it may do
here. Claude, which can log in, connects as above instead, so its person
never handles a token.

## How it works

- **It's a client of the API, not of the database.** Each tool calls the
  routes under `/api` in this process, with the token Claude brought,
  which `loggedIn` takes in a cookie's place (`backend/auth/agents.ts`).
  So Claude can do what its person can through the API, with the same
  checks, and the MCP holds no logic of its own
  (`workbench/writing-code.md`, "Headless").
- **What the person allowed is enforced on every call.** `read` makes
  `GET` requests only (403 `read-only` otherwise), and `act` everything
  else. No token, whatever it allows, changes who can log in or ends
  anyone's session: those routes take `inBrowser` (403 `browser-only`).
- **And never more than their role.** Each route of the business's names
  its area (`permitted`, `backend/auth/logged-in.ts`), and Claude reaches
  it only as far as the person's role does (403 `not-permitted`, saying
  the area and level it needed). `list_routes` leaves out the routes the
  role can't reach, and says the area and level of each one it lists.
- **Only the team can connect**, and a token stops working the moment
  its person is taken off the team in `backend/auth/access.ts`, since
  every request checks.

## The tools

| Tool          | What it does                                                                            |
| ------------- | --------------------------------------------------------------------------------------- |
| `list_routes` | The routes under `/api` the person's role reaches: method, path, and area and level     |
| `call_api`    | Calls one, as the person, with a query and a JSON body, and answers its status and JSON |

So every route a feature adds is a tool already. Changing many rows at
once goes through a job (`backend/jobs/`): `GET /api/jobs`, then a dry
run with `POST /api/jobs/:name`, and the run itself once the person says
so, which the MCP's instructions tell Claude. A feature that wants a
tool of its own, with a name and a description Claude reads first, adds
it in `index.ts`'s `registerTools`, calling its route the same way.
