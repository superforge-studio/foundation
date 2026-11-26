# 2. Taste

The business's name and color on the app, minutes in, before any account
is asked for. Three questions and a small home page: the whole look comes
in `4-make-it-theirs.md`, which builds on these answers.

## Three questions

1. **Its name**, as customers see it written.
2. **What it does**, in a sentence: what it sells or provides, and to
   whom.
3. **One main color**: a hex code, or a description ("the navy on our
   trucks").

Keep their words: they go into `PRODUCT.md` in step 4.

## Put them on the app

Read `workbench/designing.md` first: it has the habits that make a page
look generated, and the checks this one passes.

- **The color.** In `source/frontend/styles.css`, set `--primary` to it,
  in OKLCH, for light and for dark (the dark ones are in the
  `prefers-color-scheme` block), with a `--primary-foreground` that reads
  on it at a contrast of at least 4.5:1. `--ring` and `--sidebar-primary`
  follow it. Leave the neutrals as they are.
- **The name.** In `source/frontend/components/site/business-mark.tsx`, in
  place of "Your business", which the login page and the admin show too.
  Then `site_title` and `site_description` in `APP_SETTINGS`
  (`source/utilities/settings/app.ts`): the name, and the sentence.
- **The home page.** Replace `source/frontend/routes/index.tsx` with a
  page of the business's own: its name as the heading, the sentence under
  it, and the main color where it means something, like the mark or a
  rule. Nothing the owner hasn't said, and no placeholder sections: one
  plain, finished page that reads well on a phone and in dark, which step
  4 replaces with the real one.
- **The template's home page goes.** Delete
  `source/frontend/components/welcome/`, which only it used, and
  `source/frontend/queries/health.ts`, the query only its line map called.
  Keep `source/backend/health/`: Railway's healthcheck calls it.

## The check

`pnpm typecheck` passes, and the home page shows the business's name and
sentence in its color, on a computer's width and a phone's, light and
dark. Show the owner: it's on their computer only, and the next step puts
it online. Tell them what that takes before they start it: a GitHub
account, and a Railway account with a card.

Then delete this file, and go on to `3-ship.md`.
