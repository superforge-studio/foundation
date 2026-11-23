# Visits

The site's own analytics: what visitors viewed, clicked and ran into on
its pages, and what the server says happened, like a sign-up. **It's all
in the app's own Postgres**, and no other service has any part in it: the
pages send their events to the site's own address, the server keeps them,
and anything that reads them queries two tables.

| Kept in                           | What                                                                                    |
| --------------------------------- | --------------------------------------------------------------------------------------- |
| `analytics_visits`                | A visit a row: who came, from where, to which page, on what, and if they stayed         |
| `analytics_events`                | An event a row: a page's `view`, `leave`, `click`, `error` or its own, and the server's |
| `visitor-salt/today.json`, a file | Today's salt, in the Storage bucket, which counts visitors who aren't remembered        |

There's no screen over them yet. To look, ask the database:

```bash
pnpm database:sql "select country, count(*) as visits from analytics_visits where started_at > now() - interval '30 days' group by country order by visits desc"
```

## A page's events: `POST /api/visits`

The pages' script (`frontend/visitors/README.md` has what it records, and
what it never does) posts its batches to `POST /api/visits`
(`routes.ts`). The route adds who the visitor is, from their cookies,
their session, `X-Real-IP` and `User-Agent`, and calls `recordVisit`
(`record.ts`), which decides whether the site remembers them, keeps the
events, and answers:

| `recordVisit` answers | The route                                                    |
| --------------------- | ------------------------------------------------------------ |
| `remembered: true`    | Sets the `visitor` cookie to their ID, or renews it          |
| `remembered: false`   | Clears a `visitor` cookie they had                           |
| `ask`                 | Answers the page `{ ask }`, which shows the banner when true |

Whom the site remembers is `VISITOR_MODE` (`utilities/visitors.ts`),
applied by what the visitor answered the banner (their `visitor_consent`
cookie) and the country of their address (`whomToRemember` in
`visitors.ts`):

| `mode`      | Remembered                                                                      | Asked                   |
| ----------- | ------------------------------------------------------------------------------- | ----------------------- |
| `remember`  | Everyone who hasn't declined                                                    | Nobody                  |
| `ask-in-eu` | As `ask` where GDPR applies, or the country is unknown; as `remember` elsewhere | As `ask`, there         |
| `ask`       | Whoever gave their consent                                                      | Whoever hasn't answered |
| `never`     | Nobody                                                                          | Nobody                  |

GDPR applies in the EU's 27 countries, the EEA's other three (Iceland,
Liechtenstein, Norway) and the UK (`GDPR_COUNTRIES` in `location.ts`).

What's kept of whoever sent a batch:

- **A remembered visitor** is the ID in their `visitor` cookie, so their
  visits join up across days, with the user they're logged in as, and
  each visit with their IP address as it started, for 90 days ("How long
  it's kept", below).
- **A visitor who isn't remembered** is a hash of their network, their
  `User-Agent` and a salt that's replaced each UTC day (`visitors.ts`).
  They count as one visitor that day, and can't be told from anyone after
  it. No user and no address is kept beside the hash, which either would
  undo.
- **Where they were, and on what**: the country of their address
  ("Where a visitor is", below), and their device (`mobile`, `tablet` or
  `desktop`), browser and OS, from their `User-Agent` (`browsers.ts`).
- **Never their `User-Agent`**, of anyone: it's read as the visit starts
  and dropped, as a visitor's address is when the site doesn't remember
  them.
- **Nothing of a bot**, by its `User-Agent` (`isbot`), or of a browser that
  sends none: the batch is answered and dropped.

An event's time is the browser's, corrected by how far its clock is off
(the batch's `sent_at` against the server's clock), and never in the
future. One more than a week old isn't kept.

**A batch is kept whole or not at all**, in one transaction. A database
that's down fails it (500), and the page sends it again
(`frontend/visitors/README.md`).

## A visit

A visit is one visitor's events until 30 minutes pass without one
(`VISIT_GAP`). Each event joins the visit of the one before it, already
kept or in the same batch, or starts a new one. One visitor's batches are
taken in turn (an advisory lock on the visitor), so two tabs' join one
visit.

Each time a visit gets more events it's worked out from all of them again
(`summarize.ts`), in the same transaction, so it says what its events do
whatever order they arrived in:

| Column                                                                | What it says                                                                                                          |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `started_at`, `ended_at`                                              | Its first event and its last. How long it lasted is `ended_at - started_at`                                           |
| `views`, `clicks`                                                     | How many pages it viewed, and links and buttons it clicked                                                            |
| `bounced`                                                             | One page viewed at most, and nothing clicked                                                                          |
| `landing_path`, `exit_path`                                           | The first page it viewed, and the last                                                                                |
| `referrer`                                                            | The other site's hostname, as the landing said                                                                        |
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content` | The campaign in the landing's address                                                                                 |
| `ad_network`                                                          | Whose ad was clicked, by the click ID in the landing's address: `google`, `meta`, `microsoft`, `tiktok` or `linkedin` |

Beside them are who the visitor was (`visitor_id`, `anonymous`,
`user_id`, and a remembered visitor's `ip_address`), where (`country`,
`region`, `city`) and on what (`device`, `browser`, `os`), set as the
visit starts. A visitor who logs in during a
visit is on it from then on. `source/database/schema.ts` has every column.

## The server's events: `recordEvents`

What only the server knows, like a sign-up, a booking or a payment, it
records itself:

```ts
import { recordEvents } from "@/backend/visits/record"

await recordEvents(context.var.database, [
    {
        name: "booked-a-call",
        user_id: user.id,
        visitor_id: keptVisitorId(context) ?? undefined,
        properties: { plan: "monthly" }
    }
])
```

An event is a `name`, lowercase words joined by hyphens, and whatever's
known of it: `at`, a `Date`, now when it's left out; `user_id`, whoever
it's about; `visitor_id`, the ID in their `visitor` cookie
(`keptVisitorId` in `cookies.ts`), which joins it to the visits that led
to it; `path`; and `properties`, flat, at most 32, each a string of at
most 1,000 characters, a number, a boolean or null. It's a row in
`analytics_events` with `source` `server` and no visit.

**An event is never worth failing a request over.** `recordEvents` throws
on an event that isn't one, which is a bug, and when the database is
down: where a person is waiting, catch it and log it. The template's one,
`signed-up`, is recorded when a login makes someone new
(`recordSignUp` in `backend/auth/routes.ts`).

## Where a visitor is

The country comes from the visitor's IP address, in one of DB-IP's free
databases, which the server downloads itself and holds in memory
(`location.ts`): no service is asked as a visitor arrives, and no
address leaves the server. Which database is `LOCATION_DATABASE` on the
app's service (`.railway/railway.ts`):

| `LOCATION_DATABASE`              | A visit gets                | Download | In memory |
| -------------------------------- | --------------------------- | -------- | --------- |
| `dbip-country-lite`, as it ships | Its `country`               | 4 MB     | 9 MB      |
| `dbip-city-lite`                 | `country`, `region`, `city` | 60 MB    | 120 MB    |

- **It's loaded only on Railway.** A dev server, the tests and CI have no
  `LOCATION_DATABASE`, so nothing is downloaded and every visitor's
  country is unknown: `ask-in-eu` then asks everyone. A test hands the API
  its own lookup (`testApi({ locate })`).
- **The server starts the download as it starts answering**: the API's
  first request is Railway's healthcheck, so the database is usually
  loaded before a deployment takes its first visitor. A lookup never
  waits for it: until it's loaded a visit has no country, and `ask-in-eu`
  asks. It's downloaded again each week (DB-IP publishes monthly), and a
  download that fails is tried again an hour later.
- **To place visitors by city too**, change the one value in
  `.railway/railway.ts` to `dbip-city-lite`. The columns are already
  there, and the 120 MB is about a dollar a month on Railway.
- **Credit DB-IP wherever a place shows.** The databases are free under
  CC BY 4.0, as long as a screen that shows where visitors were, like a
  map or a list of countries, links back to DB-IP:
  `LOCATION_CREDIT` in `utilities/visitors.ts` has the words and the link.

## How long it's kept

| Rows                 | Kept                                       | Set by                  |
| -------------------- | ------------------------------------------ | ----------------------- |
| Events               | 90 days after they happened                | `KEEP_EVENTS_FOR`       |
| A visit's IP address | 90 days after the visit started, then null | `KEEP_IP_ADDRESSES_FOR` |
| Visits               | 25 months after they started               | `KEEP_VISITS_FOR`       |

All three are in `prune.ts`, and any can be `"forever"`. The events are
the bulk of it, and say the most about one visitor, so they go first,
with the addresses, which are as long as the events unless a copy says
otherwise; a visit, with what its events came to, stays for the reports
that look back a year or two, its address blanked. 25 months is the longest France's regulator (CNIL) says to
keep what a site measures of its audience. A runner deletes what's older,
and blanks the addresses, each hour, a batch at a time
(`pruneAnalyticsRunner`, listed in
`backend/workflows/index.ts`'s `RUNNERS`). A report over events reads 90
days back at most; one over visits, 25 months.

Removing a user leaves their visits and events, without them (`user_id`
goes null).

## In this folder

- `routes.ts`: `/api/visits`, a page's batch, and `/api/visits/consent`,
  the banner's answer.
- `cookies.ts`: the `visitor` and `visitor_consent` cookies.
- `record.ts`: `recordVisit`, a visitor's page events, each in its visit,
  and `recordEvents`, the server's own.
- `visitors.ts`: whom the site remembers, and the day's hash, with its
  salt in the bucket.
- `summarize.ts`: a visit worked out from its events.
- `browsers.ts`: a bot, or what a visitor is on, from their `User-Agent`.
- `location.ts`: a visitor's country from their address, and where GDPR
  applies.
- `prune.ts`: how long rows and addresses are kept, and the runner that
  deletes the rest and blanks the addresses.
- `tests/`: each of them, and the routes through the whole API.
