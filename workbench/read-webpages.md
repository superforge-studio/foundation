# Reading web pages

How to read any web page — including JS-rendered ones — from every
environment we run agents in (Claude Code local, the desktop app, or a cloud
sandbox). Default to Jina Reader; it works everywhere, needs no key, and
renders client-side JS.

## Default: Jina Reader

Prepend `https://r.jina.ai/` to the **full** URL (scheme included):

```bash
curl -sS --max-time 60 "https://r.jina.ai/https://docs.railway.com/networking/cdn"
```

- **Reach for it first on any docs/content page.** Don't diagnose whether
  a page is JS-heavy — Jina renders JS and is equally fine on static
  pages. Skip straight to it instead of trying plain `curl` first.
- **Keyless limit: 20 requests/min per IP.** Space out batch fetches; a
  429 means rate-limited — wait a minute and continue.
- **Plain HTTPS**, so it passes sandbox egress proxies (Claude web
  sandbox, cloud agents) where headless browsers and exotic ports don't.
- **Output is markdown**: `Title:` / `URL Source:` / `Markdown Content:`
  headers, then the page. Nav/sidebar link lists come first — the article
  body is after them, so don't judge the fetch by the first 50 lines.
- **Timeouts happen** occasionally on complex pages (typical fetch is
  1–5 s). Retry once before concluding the page is unreachable.
- **Some sites block Jina outright** — that's what the browser fallback
  below is for.

Cheaper when you know the site offers it: some docs sites publish native
markdown — Cloudflare serves any docs page as markdown if you append
`index.md`, and many sites expose an `llms.txt` index. No rate limit and
less noise than Jina.

## When Jina is blocked

Keyless Jina is per-IP, and a shared cloud egress IP can be blocked
outright rather than merely rate-limited. Measured 2026-08-15 from a Claude
Code web sandbox — every URL, instantly, no retry-after:

```json
{"code":401,"name":"AuthenticationRequiredError","status":40103,
 "message":"You have been blocked from performing anonymous queries due to
 bad IP reputation. Please authenticate."}
```

That is not the 429 described above and waiting does not clear it.

**It is per-IP and it comes and goes, so test rather than assume.** The
same keyless endpoint answered HTTP 200 with normal markdown from a Claude
Code web sandbox on 2026-09-17. Treat a block as a fact about the IP your
session happens to have today, in either direction: don't skip Jina
because a task mentions it being blocked, and don't rely on it being
there.

When you do see the 401, go straight to the site's own markdown:

- **Mintlify-hosted docs** (Upstash, and a large share of dev-tool docs)
  serve any page as markdown by appending `.md` to the path, and publish a
  full page index at `/docs/llms.txt`:

  ```bash
  curl -sS --max-time 45 -L "https://upstash.com/docs/qstash/features/flowcontrol.md"
  curl -sS --max-time 45 -L "https://upstash.com/docs/llms.txt" | grep -i "flow-control"
  ```

  API-reference pages come back as the raw OpenAPI YAML for that endpoint —
  every parameter, type and default, which is better than the rendered page.
- Cloudflare's `index.md`, or any `llms.txt` the site advertises.

Reach for these first on a known-supporting site even when Jina is working;
the point above about not hunting for them applies to sites you'd have to
guess about, not to ones you already know serve markdown.

## The trap: HTTP 200 with the content missing

A JS-rendered page fetched with plain `curl` returns **HTTP 200** and a
full-looking HTML shell — title, nav, sidebar — with the actual content
absent. The fetch "succeeds", your grep finds nothing, and it looks like
the page is empty. It isn't; the content loads client-side.

Rule: fetched HTML whose body is nav + headings + empty sections means a
JS-rendered page, not a page with nothing on it. Switch to Jina rather
than concluding the content doesn't exist.

**Measure the visible text, not the byte count.** A shell and a full page
are both tens of KB, because the weight is markup either way. Strip the
tags before judging:

```bash
sed -e 's/<script[^>]*>.*<\/script>//g' -e 's/<[^>]*>/ /g' page.html | tr -s ' \n' ' \n' | wc -c
```

A reference page carrying real schema runs several KB of visible text; a
shell runs to roughly 1.5–2.5 KB and is all sidebar. Read that as a
prompt to check what's missing, not as proof of a shell: a page whose
content is mostly collapsed can be thin and still correctly served.

**The nastier variant: HTTP 200 for a page that does not exist.** A
mistyped or guessed docs path can return 200 and a plausible HTML page
that is not the doc — no 404 to tell you the URL was wrong. Some API
references serve their landing page at **HTTP 200** for any unknown path
under them. So "I fetched it and the endpoint wasn't documented" is a
conclusion you
cannot draw from a 200 alone — confirm the page is the one you asked for
by grepping for the endpoint's own path or title before believing
anything absent from it.

## Browser fallback

For interactive flows (clicking, forms, login), authenticated pages, or
sites that block Jina:

- **Claude desktop app** — the built-in browser pane, or Claude in Chrome
  when the human asks for their own browser.
- **Claude Code (local terminal)** — no built-in browser; unless a browser
  MCP is configured in that session, Jina is the path.
- **Claude Code cloud sandbox** — **no browser at all.** Jina, or the
  site's own markdown when Jina's IP is blocked (see above) — those two are
  the whole toolkit, so don't flail past them, and report
  interactive/authenticated tasks as blocked.

## Keeping this current

Jina's rate limit and output shape were verified 2026-07-19. If Jina starts
failing consistently, returning something other than markdown, or agents
hit 429s in normal use (an API key would raise the limit ~10x — flag it to
the user), update this guide (`CLAUDE.md`, "Keep things current as you go").
