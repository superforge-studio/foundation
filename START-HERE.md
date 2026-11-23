# Start here

This codebase is a starting point: a website, an API and a database, set up
and deployed, with nothing of anyone's in it yet. This file is how it
becomes a business's own. It's written for Claude, which follows it with
the person who owns the business.

**Claude: follow these steps in order, in one session.** Ask the questions
in step 1 in plain words, a few at a time, and wait for the answers. Don't
invent anything the business hasn't told you: when something isn't
decided, choose a sensible default, say what you chose, and move on. When
every step is done, delete this file and the first section of `CLAUDE.md`,
which points here.

## 1. Ask about the business

Ask for each of these. The answers go into PRODUCT.md and DESIGN.md (step
4), so keep them in the owner's words.

1. **Its name**, as customers see it written.
2. **What it does**, in a sentence or two: what it sells or provides, and
   to whom.
3. **Who its customers are**, and what they come to it for.
4. **How it sounds**: three or four words for its voice (like "warm,
   plain, local" or "precise, expert, calm"), and anything it never says.
5. **Its colors**: hex codes, a link to its brand guide, or a description
   ("the navy and orange on our trucks"). One main color is enough.
6. **Its fonts**, if it has any. If not, offer two or three from
   [Fontsource](https://fontsource.org) that fit the voice, with a reason
   for each, and let the owner pick.
7. **Its logo**: ask for the file (SVG best, else a PNG at least 512 pixels
   square) to be put in `public/`. Without one, a simple mark in the main
   color stands in.
8. **How rounded things should look**: sharp, a little rounded, or very
   rounded (this sets `--radius`).
9. **What the home page should say for now**: a line about the business
   and what visitors should do next (call, book, email, or just know it's
   coming).
10. **Its website address**, if it has a domain it wants this on.
11. **Who will sign in**: its customers, who can sign up themselves, or
    only its own team (an internal tool, or a site only its staff edit).
12. **Its own people's email addresses**, starting with the owner's: they
    see the whole dashboard (the people who can sign in, and the work
    running in the background) from the first time they sign in.
13. **Where is the business based, and do you want visitors asked
    before they're remembered?** The site's pages count what visitors
    view and click, in the app's own database, and the site can remember
    a visitor's browser between visits, so their visits join up. Say
    plainly: by default the site sets a lasting cookie on every visitor,
    with no banner, and keeps each visit with the country it came from,
    never the visitor's IP address; the EU and the UK generally require a
    visitor's consent for the cookie. A business based in the EU can
    have a small banner ask everyone first; one based elsewhere can have
    it ask only visitors where those rules apply, and remember everyone
    else; and one that wants nothing kept on anyone's browser can turn
    remembering off. Whoever isn't remembered is still counted, a day at
    a time. This is how the site behaves, not legal advice: an owner who
    needs to know what the law asks of them should ask someone qualified
    to say.

## 2. Make it look like the business

All of the look lives in `source/frontend/styles.css`, as shadcn's theme
tokens, which every component in `source/frontend/components/primitives/`
is drawn with ([shadcn's theming](https://ui.shadcn.com/docs/theming)).

- **Colors.** Turn the business's colors into the tokens, in OKLCH, for
  both light and dark (the dark ones are in the `prefers-color-scheme`
  media query). The main color is `--primary`, with a
  `--primary-foreground` that reads on it at a contrast of at least 4.5:1;
  `--ring` and `--sidebar-primary` usually follow it. Keep the neutrals
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
  `public/favicon.svg` with the mark (an SVG with a `<title>`), and
  replace the placeholder cube in `source/frontend/routes/index.tsx`'s
  header (the favicon, in an `<img>`) with the logo, and in
  `source/frontend/components/site/business-mark.tsx`, the sign-in page's
  and the dashboard's, with the business's name in place of "Your
  business".

Read `workbench/designing.md` before this step and the next: it lists the
habits that make a site look generated, and the checks the page has to
pass.

## 3. Write the home page, and say who signs in

Replace `source/frontend/routes/index.tsx`'s placeholder with the
business's own page: its name, the line from step 1, and what visitors
should do next. Keep it one page for now; more pages are routes under
`source/frontend/routes/`, linked from the home page. Then set the page's
title and description in `source/frontend/routes/__root.tsx`'s `head`.
The placeholder's line map, with the health check running down it, is
there to show the owner what the codebase has and that it runs; it isn't
for visitors. Delete `source/frontend/components/welcome/`, which only it
uses, and keep `source/backend/health/`, which Railway's healthcheck
needs.

Keep the sign-in page, `source/frontend/routes/sign-in.tsx`, where the
business's customers and staff will sign in, and where its emails link,
in the business's voice (its name is in `business-mark.tsx`, from step
2). Link to it from the home page only if visitors should see it yet.

Keep the dashboard too, `source/frontend/routes/dashboard/`, behind
sign-in: the business's own people see everyone who can sign in and the
work running in the background, and everyone else their own account.
Then say who signs in, from step 1's answers, in `ACCESS` in
`source/backend/auth/access.ts`:

- **`sign_in`**: `"anyone"` when customers sign up themselves, and
  `"listed"` when only the team signs in, so a stranger can't make an
  account; the team then adds anyone else on the dashboard's People
  screen.
- **`internal_users`**: the business's own people, the owner first, each
  with their first name, last name and the email they'll sign in with,
  in place of the placeholders (Ada Lovelace and Grace Hopper, at
  example.com). They're the only people who are ever internal, and the
  dashboard's People screen can't add or change them: someone joins or
  leaves the team with a change here. Everyone else is `external`. If
  the business has more kinds of people than those two, like technicians
  and customers, add the roles to `INTERNAL_ROLES` or `EXTERNAL_ROLES` in
  `source/utilities/schemas/users.ts`, and give each internal person
  theirs (`workbench/writing-code.md`, "Roles and who can sign in").

Then say whom the site remembers, from step 1's answer, in
`VISITOR_MODE` in `source/utilities/visitors.ts`:

- **`"remember"`**, as it ships: everyone, with no banner. Keep it when
  the owner has no other answer.
- **`"ask"`**: for a business based in the EU. The banner asks everyone,
  and only those who accept are remembered.
- **`"ask-in-eu"`**: for a business based elsewhere that wants visitors
  asked where the EU's and the UK's rules apply. The banner asks them,
  and everyone else is remembered.
- **`"never"`**: for an owner who wants nothing kept on anyone's
  browser. No one is remembered or asked.

The banner (`source/frontend/components/site/consent-banner.tsx`) shows
only in `"ask"` and `"ask-in-eu"`, to a visitor who hasn't answered; put
its words in the business's voice too.

## 4. Write PRODUCT.md and DESIGN.md

These are what every later change reads first (`CLAUDE.md`'s hooks), so
write them for someone who has never met the business.

- **`PRODUCT.md`**: who the business is and who it serves, what it sells,
  its voice and the words it never uses, what the site is for today, and
  any commitments (what it never claims, what it never names).
- **`DESIGN.md`**: the visual system as `styles.css` now sets it: each
  color token with its value and what it's for, the fonts and where each
  is used, the radius, the logo and how it's used, and the rules that keep
  it consistent (like which color is only for the main action).

## 5. Make the names the business's own

The codebase is called `starter-template` in a few places. Rename it to a
short, lowercase name for the business (like `acme-plumbing`):

- `name` in `package.json`.
- In `.railway/railway.ts`: the project, the repository
  (`github("<owner>/<repository>", …)` is this repository on GitHub, as
  `git remote get-url origin` shows it), and the service's Railway address
  (`<name>.up.railway.app`, which has to be free across all of Railway).
  The service itself is `app`, which stays.
- The region, `REGION` at the top of `.railway/railway.ts`: ask where most
  of the business's customers are, and pick the nearest of Railway's four
  (`us-west`, California; `us-east`, Virginia; `europe-west`, Amsterdam;
  `asia-southeast`, Singapore). The app, its database and its buckets all
  run there. Choose it now: once the first apply has made the buckets,
  they can't move.
- `README.md`: its title and first paragraph, and the "This template"
  section, which goes.

Leave `.superforge/` as it is: `superforge.json`'s `starter-template` is
the template this codebase came from, which updates read
(`workbench/updating.md`), not this codebase's name, and `releases/` holds
the notes of the template's releases. Keep `CHANGELOG.md` and `LICENSE`
too.

## 6. Check it, and ship it

```bash
pnpm format && pnpm check
```

Then `pnpm dev` and look at the home page at http://localhost:3000, the
sign-in page at http://localhost:3000/sign-in, and the dashboard at
http://localhost:3000/dashboard, signed in as the owner, on a computer's
width and a phone's, in light and dark, against the checks in
`workbench/designing.md`. Signing in works there with nothing set up: a
dev server emails nothing, and shows the code on the page.
`pnpm database:seed` fills the dashboard with sample people and runs. When it's
right, delete this file and `CLAUDE.md`'s first section, commit on a
branch, and follow `workbench/commit-and-deploy.md` to put it on Railway:
its "Setting up Railway" section is the one-time setup, which needs the
owner for a token, for the app's project and its key on Superforge Infra,
which sends the sign-in emails, and, if there's a domain, its DNS.
