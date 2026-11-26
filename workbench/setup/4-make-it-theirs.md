# 4. Make it theirs

The whole interview, then the look, the home page, the team, `PRODUCT.md`
and `DESIGN.md`, the names, the project's description, and the first
things the owner wants the app to do. When this step's check passes, the
setup is done, and this folder goes with `START-HERE.md`.

## The interview

Step 2 put the business's name, what it does and its main color in the
code (`business-mark.tsx`, `APP_SETTINGS`'s `site_title` and
`site_description`, and `--primary`): confirm them, then ask for each of
these. The answers go into `PRODUCT.md` and
`DESIGN.md`, so keep them in the owner's words.

1. **Who its customers are**, and what they come to it for.
2. **How it sounds**: three or four words for its voice (like "warm,
   plain, local" or "precise, expert, calm"), and anything it never says.
3. **Its colors**, beyond the main one: hex codes, a link to its brand
   guide, or a description.
4. **Its fonts**, if it has any. If not, offer two or three from
   [Fontsource](https://fontsource.org) that fit the voice, with a reason
   for each, and let the owner pick.
5. **Its logo**: ask for the file (SVG best, else a PNG at least 512
   pixels square) to be put in `public/`. Without one, a simple mark in
   the main color stands in.
6. **How rounded things should look**: sharp, a little rounded, or very
   rounded (this sets `--radius`).
7. **What the home page should say for now**: a line about the business
   and what visitors should do next (call, book, email, or just know it's
   coming).
8. **Its website address**, if it has a domain it wants this on.
9. **Who else is on its team**: each one's name and the email they'll log
   in with. Only they log in, to the admin, the app's own screens; its
   customers don't have accounts here.
10. **Whether anyone on the team should see or change less** than the
    owner, like a technician who shouldn't run jobs that change many rows
    at once. As it ships, everyone sees and changes everything the admin
    has.
11. **Where is the business based, and do you want visitors asked before
    they're remembered?** The site's pages count what visitors view and
    click, in the app's own database, and the site can remember a
    visitor's browser between visits, so their visits join up. Say
    plainly: by default the site sets a lasting cookie on every visitor,
    with no banner, and keeps every visit for good, with what was viewed
    and clicked on it and the country it came from, and, for 90 days, the
    visitor's IP address; the EU and the UK generally require a visitor's
    consent for the cookie. A business based in the EU can have a small
    banner ask everyone first; one based elsewhere can have it ask only
    visitors where those rules apply, and remember everyone else; and one
    that wants nothing kept on anyone's browser can turn remembering off.
    Whoever isn't remembered is still counted, a day at a time, and their
    address isn't kept. This is how the site behaves, not legal advice: an
    owner who needs to know what the law asks of them should ask someone
    qualified to say.

## The look

All of it lives in `source/frontend/styles.css`, as shadcn's theme
tokens, which every component in `source/frontend/components/primitives/`
is drawn with ([shadcn's theming](https://ui.shadcn.com/docs/theming)).
Read `workbench/designing.md` before this and the next part: it lists the
habits that make a site look generated, and the checks every page passes.

- **Colors.** Turn the business's colors into the tokens, in OKLCH, for
  both light and dark (the dark ones are in the `prefers-color-scheme`
  media query). Step 2 set `--primary`; keep the neutrals
  (`--background`, `--foreground`, `--muted`, `--border`) neutral or
  tinted only slightly toward the main color, and check every text and
  background pair for contrast in both modes.
- **Fonts.** `pnpm add @fontsource-variable/<name>` (or
  `@fontsource/<name>` for a font with no variable version), replace the
  Geist import at the top of `styles.css`, and set `--font-sans` (and
  `--font-heading` if headings get their own). Remove
  `@fontsource-variable/geist` from `package.json` if nothing uses it.
- **Corners.** Set `--radius`: about `0.25rem` for sharp, `0.625rem` for a
  little rounded, `1rem` for very rounded.
- **Logo and favicon.** Put the logo in `public/`, replace
  `public/favicon.svg` with the mark (an SVG with a `<title>`), and put
  the logo in `source/frontend/components/site/business-mark.tsx` in
  place of the favicon: the login page's, the admin's and the not-found
  page's.

## The home page, and who logs in

Replace step 2's home page, `source/frontend/routes/index.tsx`, with the
business's own: its name, the line from the interview, and what visitors
should do next. Keep it one page for now; more pages are routes under
`source/frontend/routes/`, linked from the home page. Update
`site_title` and `site_description` in `APP_SETTINGS`
(`source/utilities/settings/app.ts`) if the interview changed them.

Keep the login page, `source/frontend/routes/login.tsx`, where the team
logs in and where its emails link, in the business's voice. Link to it
from the home page only if visitors should see it yet.

Keep the admin too, `source/frontend/routes/admin/`, behind login: its
Overview says the dashboard is the business's to build, a section at a
time, and its Settings shows who's on the team, each as their role
allows. Then add the rest of the team to `ACCESS` in
`source/backend/auth/app.ts`, the app's own, which no update changes,
after the owner step 3 listed:

- **`team`**: each with a slug (their first name, lowercase, like `ada`,
  or with a letter after it when two share one, like `nick-r`), which
  never changes, their first name, last name and the email they'll log in
  with. Anyone listed without a role is a `member`. They're the only
  people who log in, and nothing on a screen adds or changes them:
  someone joins or leaves the team with a change here. Someone who takes
  over another's work, even their mailbox, is listed with a slug of their
  own, never the other's; changing someone's address logs them out
  everywhere, once, and revokes their API tokens.
- **`roles`**: what each role may do, area by area. As it ships, a member
  may do everything the owner may. If someone should see or change less,
  give `member` less, or add a role of their own, like `technician`: its
  name in `APP_ROLES` (`source/utilities/permissions/app.ts`), its areas
  here, and someone listed with it (`workbench/writing-code.md`, "The
  team and what each role may do").

Then say whom the site remembers, from the interview, as `visitor_mode`
in the same `APP_SETTINGS`:

- **`"remember"`**, as it ships: everyone, with no banner. Keep it, and
  leave `visitor_mode` out, when the owner has no other answer.
- **`"ask"`**: for a business based in the EU. The banner asks everyone,
  and only those who accept are remembered.
- **`"ask-in-eu"`**: for a business based elsewhere that wants visitors
  asked where the EU's and the UK's rules apply. The banner asks them,
  and everyone else is remembered.
- **`"never"`**: for an owner who wants nothing kept on anyone's browser.
  No one is remembered or asked.

The banner (`source/frontend/components/site/consent-banner.tsx`) shows
only in `"ask"` and `"ask-in-eu"`, to a visitor who hasn't answered; put
its words in the business's voice too.

## PRODUCT.md and DESIGN.md

These are what every later change reads first (`CLAUDE.md`'s hooks), so
write them for someone who has never met the business.

- **`PRODUCT.md`**: who the business is and who it serves, what it sells,
  its voice and the words it never uses, what the site is for today, and
  any commitments (what it never claims, what it never names).
- **`DESIGN.md`**: the visual system as `styles.css` now sets it: each
  color token with its value and what it's for, the fonts and where each
  is used, the radius, the logo and how it's used, and the rules that
  keep it consistent (like which color is only for the main action).

## The rest of the names

Step 3 named the package, the repository and the Railway project. In
`README.md`'s "Develop" section, take out "(`ada@example.com` as the
template ships)": the seed's team is the one listed now.

Leave `.superforge/superforge.json` as it is but for `project_id`:
`foundation` is the template this codebase came from, which updates read
(`workbench/updating.md`) and every page's `<meta name="generator">`
names. Keep `LICENSE` and `THIRD-PARTY-NOTICES.md`: `LICENSE` is the terms
this codebase is under, the Superforge Foundation License. And keep that
generator tag (`source/utilities/template.ts`): it credits Superforge in
the pages' source, never on the page, and the license asks every site
built on Foundation to keep it.

## A domain, if there is one

A domain the business owns goes on the app as `workbench/commit-and-deploy.md`,
"Domains", says: Claude adds it, the owner adds two DNS records where the
domain's DNS is, and Claude adds it to the Infra project with `add_domain`.
It can wait for a later session.

## Claude in the live app

The app has an MCP server of its own, at `https://<its domain>/admin/mcp`,
so Claude can read and change the live app's data through its API, as
whoever lets it in, never more than their role allows. Offer it to the
owner: they add the address once as a custom connector on claude.ai
(Settings → Connectors), which reaches the Claude app, cloud sessions and
scheduled tasks, and press Allow on the app's own page. Each person on the team does
it for themselves. `source/backend/mcp/README.md` has the rest, and the
API token an agent with no browser uses instead.

## What the app is for

Describe the Infra project again with `describe_project`, now with
everything the owner has said: what the business is, who it serves, what
this app does for them today and what it's meant to do next. From here
on, `CLAUDE.md`'s "Keep things current" keeps it up to date.

Then ask what the owner wants the app to do first, and file each want on
its board with `file_note`, a note each, in their words. Say which you'd
start with, and why, and leave the choice to them.

## Ship it

```bash
pnpm format && pnpm check
```

Then look at the home page, the login page and the admin, logged in as
the owner, on a computer's width and a phone's, in light and dark, against
the checks in `workbench/designing.md`. When it's right, delete this file,
`START-HERE.md`, the empty `workbench/setup/` folder, and `CLAUDE.md`'s
first section, "First: is this codebase someone's yet?". Commit on a
branch, open the PR (`commit-and-deploy.md`, "Pull requests"), and merge
it once `check` passes.

## The check

`PRODUCT.md` exists, the live site is the business's own, and
`START-HERE.md` and `workbench/setup/` are gone. The setup is done.
