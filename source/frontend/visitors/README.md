# Visitors

What visitors view, click and run into on the site's pages, kept as
events in the app's own database, where the site's own analytics reads
them (`backend/visits/README.md` has what's kept, for how long, and how to
read it). The app's server records what only it knows, like a sign-up,
beside them.

It's a small script of the app's own, not a third party's, and it **sends
only to the app's own address**: `POST /api/visits`, same-origin, as
JSON, like any call to the app's API. The app's server adds who the
visitor is and keeps the batch (`backend/visits/`): no other service
sees it. An ad blocker sees nothing to block: no other site is called,
and no file, folder or address the browser asks for holds `analytics`,
`track`, `collect`, `pixel` or `beacon`.

**The script keeps nothing on the device**: no ID, no visit, no answer
to the banner, and no queue of waiting events, which live in the page's
memory only. Safari deletes whatever a page's script stores after a week
without a visit, so what has to last is a cookie the app's server sets
instead, which no script can read (below).

## When it runs

- **Only in a browser.** The root route starts it from an effect
  (`routes/__root.tsx`), which never runs in the prerender, and every
  function here does nothing on the server.
- **On every page, from the first visit.** Whether anything is kept is
  the server's to decide: the script waits for nothing, and needs no key
  or account anywhere.
- **A dev server keeps what its pages send** in the checkout's own
  database, like a build in production's, so a report can be built on
  real rows before it ships (`pnpm database:seed` adds sample visits).
  It places no visitor, since only Railway names a location database
  (`backend/visits/README.md`, "Where a visitor is").

## What's recorded

| Event   | When                                                        | Properties                                                                                                                                                                                                                                                                           |
| ------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `view`  | Each page the router resolves, the first one once           | `title`, the page's. On the first: `referrer`, the other site's hostname; every `utm_` parameter in the address, the first ten; an ad's click ID (`gclid`, `gbraid`, `wbraid`, `fbclid`, `msclkid`, `ttclid`, `li_fat_id`); `screen`, like `1920x1080`; and `language`, like `en-US` |
| `leave` | Leaving a page: another page, or the page hiding or closing | `scroll`, how far down it was scrolled (0 to 100), and `visible_ms`, how long it was visible                                                                                                                                                                                         |
| `click` | A link, a button, `role="button"` or anything `data-track`  | `target`, its `data-track` or else its tag; `text`, its label or what it shows; a link's `href`                                                                                                                                                                                      |
| `error` | An uncaught error or rejected promise, ten a page at most   | `message`, and where: `source`, `line`, `column`                                                                                                                                                                                                                                     |

Each has its page's path and when it happened, and nothing of who the
visitor is: the server adds that, and works out their visits itself, a
new one after 30 minutes with nothing happening. A page whose tab is
hidden and comes back has a `leave` each time it's left, each with the
time it was visible since the last; `scroll` is the deepest so far. A
change to only the query or the fragment isn't a new page. Everything
stays within what the server takes: at most 32 properties, and a string
of at most 1,000 characters.

A batch goes every five seconds while there's something to send, at
most 100 events and 32 KB a call, and as the page hides, what's left goes
with `keepalive`, which outlives the page. A batch the app's server
couldn't take (no network, or a 5xx while it's down or deploying) is
tried again, waiting longer each time, up to five minutes, and once more
with `keepalive` as the page hides; one it refused (a 4xx, like the 429
a network past what a day allows is answered, `backend/visits/README.md`)
is dropped. A
page holds at most 500 waiting, in its memory, and drops the oldest past
them: what hasn't gone when the page closes is lost. The server keeps a
batch whole or not at all, so one it couldn't keep, like while its
database is down, comes back as a 5xx and is sent again.

## What's never recorded

- **A query string or a fragment**, in a path, a link or an error, which
  can hold a token or an address. A page's path is `location.pathname`.
  Only the landing's `utm_` parameters and click IDs are read from its
  address.
- **Anything typed**: a field's value is never read, and a click on a
  field keeps no text.
- **Anything shaped like an email address**, in a title, a click's text,
  a campaign or an error's message: it becomes `[email]`.
- **The text of anything inside `data-private`**, like the dashboard,
  which shows people's names and the business's data
  (`routes/admin/route.tsx`). Its clicks still count, by `target` and
  `href`.
- **A click inside `data-untracked`**, which isn't the visitor's own,
  like the toolbar the business's own people see (`components/toolbar/`).
- **Who's logged in, from the page.** The server adds their user ID to
  every batch from its own session (`backend/visits/routes.ts`), and
  keeps it only of a visitor the site remembers.
- **The visitor's `User-Agent`**, or **the IP address of one the site
  doesn't remember**. The server reads their country and what they're on
  from them, and keeps neither. A remembered visitor's address is kept on
  their visit, for 90 days (`backend/visits/README.md`).

## Remembering a visitor

**`VISITOR_MODE` in `source/utilities/visitors.ts` is the owner's
choice**, which `START-HERE.md` asks about. The server applies it to
every batch, by what the visitor answered and the country of their IP
address, and decides whether the site remembers them and whether the
page asks them:

| Mode                    | Remembered                                                                      | Asked                   | For                                  |
| ----------------------- | ------------------------------------------------------------------------------- | ----------------------- | ------------------------------------ |
| `remember`, as it ships | Everyone who hasn't declined                                                    | Nobody                  |                                      |
| `ask-in-eu`             | As `ask` where GDPR applies, or the country is unknown; as `remember` elsewhere | As `ask`, there         | A business outside the EU that cares |
| `ask`                   | Whoever accepted                                                                | Whoever hasn't answered | A business based in the EU           |
| `never`                 | Nobody: the server sets no cookie                                               | Nobody                  |                                      |

GDPR applies in the EU, the EEA and the UK. The country comes from the
visitor's IP address, in a database the server downloads from DB-IP and
holds itself, on Railway only (`backend/visits/README.md`, "Where a
visitor is"). A dev server's visitors, and anyone else the server can't
place, are of an unknown country, so `ask-in-eu` asks them.

A remembered visitor is a lasting ID, a UUID, in the `visitor` cookie,
which the server sets and renews with each batch of theirs. Their events
are kept under it, so their visits join up across days, with whoever
they're logged in as, and each visit with their IP address, for 90 days.
A visitor who isn't remembered has no `visitor` cookie, and the server
clears one they had: they're counted as one visitor a day, by a hash that
can't be made again once the day is over, with no user or address beside
it.

| Cookie            | Holds                                             | Set by                                     |
| ----------------- | ------------------------------------------------- | ------------------------------------------ |
| `visitor`         | Their lasting ID, a UUID                          | `/api/visits`, for a visitor it remembers  |
| `visitor_consent` | `given` or `declined`: their answer to the banner | `/api/visits/consent`, when they answer it |

Both are `HttpOnly`, `SameSite=Lax`, `Path=/`, for 400 days (the longest
Chrome keeps one) from when they were last set, and `Secure` everywhere
but plain http on this computer (`backend/visits/cookies.ts`).

**The banner** (`components/site/consent-banner.tsx`, drawn by the root
route on every page, the dashboard's too) shows when the server's latest
answer to a batch said `ask: true`. Accept and Decline post the answer to
`/api/visits/consent` and hide it. Declining clears the `visitor` cookie
at once; after accepting, the next batch's answer sets it. A batch the
server answered before it had the answer can't bring the banner back,
but one after an answer it didn't keep does, so the visitor is asked
again.

The answer is the visitor's alone to change for now: a link that lets
them change their mind would call `answerConsent()` from `index.ts`.

## Naming a click: `data-track`

Tailwind's classes say nothing about what a button is for, so a click is
named by its `data-track`, on the link or button itself:

```tsx
;<a href="/book" data-track="book-a-call">
    Book a call
</a>
```

Without one, a click is named by its tag (`a`, `button`), with its text.

## The app's own events: `track()`

```ts
import { track } from "@/frontend/visitors"

track("booked-a-call", { plan: "monthly", seats: 3 })
```

A name is lowercase words joined by hyphens, at most 64 characters, and
not one of the four above; properties are flat, at most 32, each a
string of at most 1,000 characters, a number, a boolean or null. One
that doesn't fit is dropped with a warning in the console. They go like
the script's own, for every visitor, and are kept under whoever the
server says the visitor is. What has to count even when a page can't send
it, like a sign-up or a payment, the server records itself (`recordEvents`
in `backend/visits/record.ts`), in the feature where it happens.

## In this folder

- `index.ts`: what the app calls: `startVisitors`, `track`, and the
  banner's `askingConsent`, `onAskingChange` and `answerConsent`.
- `record.ts`: the recorder, which turns what the browser says into
  events and sends them, with the clock and the senders handed to it, so
  its tests run in Node.
- `browser.ts`: the recorder wired to the page and the router, and the
  calls to `/api/visits` and `/api/visits/consent`, through the API's
  typed client.
- `describe.ts`: what an event says about a page, a landing, a click or
  an error, scrubbed.
- `queue.ts`: the batches, in memory.
- `tests/`: the recorder, the batches and the scrubbing, in Node.

What a page sends is checked by the same schemas on both sides
(`utilities/schemas/visits.ts`).
