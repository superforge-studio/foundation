# Toolbar

A small toolbar on every page, for the business's own people, the ones
listed as internal in `backend/auth/access.ts`: when
they spot something that should change, they click it, say what, and
get back to work. It goes to Superforge Infra as a comment, and Claude
fixes what's filed later: when someone asks it to work through them, or
on a schedule. The business's own people are the app's quality control,
without stopping to fix things as they go.

**Only on a computer with a mouse** (`(hover: hover) and (pointer:
fine)`): picking an element by touch is fiddly, and on a phone the
toolbar covers too much. Nobody else sees it: a visitor, a phone or a
tablet, and the prerender, which draws every page for a visitor, get
nothing, and `/api/comments` refuses anyone who isn't logged in, which
only the team can be (`loggedIn`).

## How it works

1. **Comment** turns on comment mode.
   The pointer becomes a crosshair, and the element under it is outlined
   as a browser's inspector outlines it, with its tag and size. A part
   of an icon counts as the whole icon.
2. **A click picks the element** instead of doing what it would: a
   link doesn't go, a button doesn't act, and the visitors' script
   doesn't count it (`picker.tsx` stops the press on the window, before
   the page's own listeners hear it). The toolbar itself works as ever.
3. **The comment box** opens beside it (`composer.tsx`). Clicking
   another element moves the comment there, keeping what's written.
   **Save**, or **⌘↵**, posts it to the app's own `POST /api/comments`
   (`backend/comments/routes.ts`), which sends it on to Infra with the
   key and who's logged in (`backend/infra/README.md`, "Comments").
   The toolbar says **Saved**, and comment mode ends.
4. **Escape**, which the Comment button shows while comment mode is
   on, closes the box and goes back to picking; again, it ends comment
   mode.

Clicking the **ⓘ** opens a note on what the toolbar is for and where
comments go, toward the middle of the window; a click elsewhere, or
Escape, closes it.

A comment that didn't save keeps what was written, and says why: logged
out, or Infra not answering.

## Moving it

The toolbar starts at the middle of the bottom. Its **handle**, the grip
on its left, drags it anywhere, and let go, it glides to the nearest of
five pins: the middle of the bottom, or a corner (`pins.ts`). The arrow
keys on the handle move it a pin at a time. Each browser keeps where it
was put, in localStorage, read back through zod, so a browser that won't
keep it starts at the bottom again. Each pin is a place in CSS
(`placement.ts`), so it stays put as the window resizes, and the comment
box keeps clear of whichever edge it's on.

## What a comment carries

| Field      | What                                                                                                                                                                                                                                                |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `body`     | What was written, at most 5,000 characters                                                                                                                                                                                                          |
| `path`     | The page's path, without its query or fragment                                                                                                                                                                                                      |
| `title`    | The page's title                                                                                                                                                                                                                                    |
| `element`  | `selector`, a CSS selector from the body (or from an id someone wrote) that finds the element again; `tag`; `text`, what it shows or its label; `classes`, its `class`, which an agent can search the code for; and `box`, where it was on the page |
| `viewport` | The window's size                                                                                                                                                                                                                                   |

The server adds the user's ID and their browser's `User-Agent`. Infra
keeps no app's users, so never their email.

The selector skips Tailwind's classes, which say nothing about which
element it is, and React's and Base UI's own ids, which change between
renders. It names each step by its tag, its `data-track` and which of its
kind it is, so naming an element with `data-track` makes its comments
easier to place.

## What's never sent

The element's text follows the visitors' rules
(`frontend/visitors/README.md`): nothing shaped like an email address,
no query in an address, and **no text at all from a form's field or from
inside `data-private`**, like the dashboard, which shows people's names.
A comment there still carries the element's selector, classes and box.

## In this folder

- `toolbar.tsx`: the toolbar, which the root route draws on every page,
  and what it's doing: idle, picking or writing.
- `pins.ts`: where it can be pinned, the nearest pin to where it's let go
  and where an arrow key moves it, and keeping the pin in localStorage.
- `placement.ts`: dragging it by its handle, and the glide to its pin.
- `picker.tsx`: picking an element, the outline round it, and where it is
  as the page scrolls.
- `composer.tsx`: the comment box, and saving through
  `queries/comments.ts`.
- `element.ts`: what the page says about the element picked, read off it.
- `describe.ts`: what the comment says about it, from that, without the
  page.

`describe.ts` and `pins.ts` don't touch the page, so their tests run in
Node (`tests/`).

The outline's color is the `--highlight` token (`styles.css`), apart from
the business's colors so it shows on any of them. The toolbar and the
comment box are marked `data-toolbar`, which picking leaves alone, and
`data-untracked`, which the visitors' script doesn't count.
