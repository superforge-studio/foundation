# The admin

Everything behind login is drawn from this folder: the admin, `/admin`,
the business's own dashboard, for the team listed in code
(`backend/auth/access.ts`). This is how a screen is built in it: the frame
it sits in, what the template's own screens are, what stands in front of
them, the steps that add a section, and the pieces already made.

A screen is three things: a route file under `routes/admin/`, which reads
the address and runs the queries; its components here, in a folder of its
own once there are a few; and its queries in `frontend/queries/`.

## The frame

`DashboardFrame` (`shell.tsx`) is drawn by `routes/admin/route.tsx`, never
by a screen. A screen is what goes in its `<main>`.

- **On a computer** (768 pixels and wider), a sidebar 15rem wide: the
  business's mark, the sections in their groups, each group under its
  name, and at its foot who's logged in, with the gear beside them.
- **On a phone**, a bar across the top with the mark, the gear and who's
  logged in, as their initials alone, and under it every section in one
  row that scrolls sideways, without the groups.
- **Who's logged in** is their initials, their name and their role
  (`ROLE_NAMES`, `words.ts`), and opens `/admin/account`. **The gear**
  opens `/admin/settings`, for a role that may read some part of it
  (`settingsShownTo`, `settings/screen.tsx`).
- **The frame is the window's height and never scrolls.** A screen
  scrolls itself, so its outermost element is `min-h-0 flex-1
  overflow-y-auto`, or `Panes`, whose two halves each scroll.

**The sections** are a `Navigation`: groups, each with its sections, each
section its address (`to`), its `name`, its `icon` from `lucide-react`,
and its `area`.

- **`ADMIN_NAVIGATION`** (`navigation.ts`) is the Overview, in a group of its
  own with no name, then this app's own groups, `APP_NAVIGATION`
  (`app.ts`): none, as the template ships.
- **A section's `area`** is the permission area its routes name
  (`utilities/permissions/`). `shownTo` leaves a section out of the
  sidebar for a role that can't read its area, and a group with none
  left. `adminSectionAt` finds the section an address is in, and
  `routes/admin/route.tsx` draws `NotPermitted` in the screen's place for
  a role that can't read it. A section with no `area`, like the Overview,
  shows to everyone on the team.
- **Settings and the account aren't sections.** They're the gear and the
  name at the sidebar's foot.

## The template's screens

- **The Overview**, `/admin` (`routes/admin/index.tsx`, `overview.tsx`),
  where the admin opens, for everyone on the team: it says the dashboard
  is the business's to build, and how. It writes the prompt for a section
  of the business's own from what it keeps track of, and suggests
  sections for what the app already has with no screen yet, the team's
  files and the workflows' runs, each gone once a section in the sidebar
  shows its area, and the site's visits on the Overview itself. It's a
  starting point: a business makes it the home its team wants to open on.
- **Settings**, `/admin/settings` (`routes/admin/settings.tsx`,
  `settings/`): what the app runs on, a part each (`SettingsPart`), each
  shown to a role that may read its area. The template's part is the team
  (`settings/team.tsx`), then this app's own, `APP_SETTINGS` (`app.ts`).
  A role that reads none has no gear, and Settings draws `NotPermitted`.
- **Your account**, `/admin/account` (`routes/admin/account.tsx`,
  `account.tsx`), everyone's own: who they're listed as, what their role
  lets them do, the browsers they're logged in on, where they've let
  Claude in (`connections.tsx`) and their API tokens (`api-tokens.tsx`).

**The team is listed in code, so Settings changes no one.** It lists
everyone `access.ts` has listed, owners first, and those taken off last,
with how to bring them back, and what each role may do in each area
(`RoleLevels`, `permissions.tsx`). Add someone, for a role that may write
the `team` area, the owner's as the template ships, writes the prompt
that has Claude Code list them, in a pull request (`prompt.tsx`).

**A part of Settings** is a component of its own, with no props, which
asks the API for what it shows and draws a `<section>` under an `h2`
(`sectionHeading`), as `Team` does. It goes in `APP_SETTINGS` with its
`key` and the `area` its routes name.

## In front of a screen

`routes/admin/route.tsx` decides what's drawn before any screen is, at the
address that was opened. Nobody is sent elsewhere, so logging in lands
them where they meant to go.

| Who opens it                                  | Sees                                             | From        |
| --------------------------------------------- | ------------------------------------------------ | ----------- |
| Anyone, while the session is asked for        | `DashboardLoading`, the frame's shape in gray    | `gate.tsx`  |
| Someone logged out                            | `DashboardLogin`, the login form under a heading | `gate.tsx`  |
| A role that can't read the section            | `NotPermitted`, in the frame                     | `shell.tsx` |
| One of the team, at an address that's no page | `AdminNotFound`, in the frame                    | `shell.tsx` |

- **All of it is a courtesy.** The API decides who may see what, whatever
  a page shows: `permitted` on every route of the business's
  (`backend/auth/logged-in.ts`).
- **The admin is wrapped in `data-private`**, so the pages' script never
  keeps the text of what's clicked inside it (`frontend/visitors/README.md`).
- **A screen reads who's logged in with `useSession()`**
  (`frontend/queries/auth.ts`), which answers `loading` and `logged-out`
  inside the frame too, though `route.tsx` has dealt with both: a screen
  returns null for them. **A button that writes** shows only to a role
  that may: `allows(session.permissions, "team", "write")`, as Add
  someone does.

## Adding a section

1. **Its routes under `/api` first**, in a feature of `backend/`, each
   naming its area with `permitted("<area>")`
   (`workbench/writing-code.md`, "Headless" and "The team and what each
   role may do"). A new area goes in `utilities/permissions/app.ts`, and
   a role has it once `roles` gives it one.
2. **Its queries**, a file in `frontend/queries/` named for that area of
   the API: `queryOptions` through the typed client, or `mutationOptions`
   for a change. An answer that isn't the one it wants throws
   `FailedRequest(await readFailure(response))`. Its types come from the
   client (`InferResponseType`), never written out. A mutation's
   `onSuccess` invalidates what it changed.
3. **Its route file**, `routes/admin/<name>.tsx`:
   `createFileRoute("/admin/<name>")` with `validateSearch`, a zod object
   in which every parameter ends `.optional().catch(undefined)`, so a
   mangled address falls back to the screen's defaults; a `head` whose
   title is `<Name> · Admin`; and a component that reads the search, runs
   the queries and hands them on. It needs no `ssr: false` and no line in
   `vite.config.ts`: `route.tsx` and the prerender's filter cover
   everything under `/admin`.
4. **`pnpm dev` once**, which writes the route into
   `frontend/routeTree.gen.ts`. Until then a `Link` to it doesn't
   typecheck. Commit that file with the route.
5. **Its components**, here, in a folder of its own once there are a few.
   Draw with the shared pieces below before making a new one.
6. **Its place in the sidebar**: a group in `APP_NAVIGATION` (`app.ts`),
   or a line in one, with the same `area` its routes name. That one line
   hides it from a role that can't read the area, and draws
   `NotPermitted` if they open it anyway.
7. **Look at it**: `pnpm dev`, with `pnpm database:seed` for rows to show,
   at a phone's width and a computer's, in light and dark
   (`workbench/designing.md`), logged in as the owner and as the member.

## A list beside the one chosen

Most sections are this: a list on the left, and the one chosen from it on
the right.

- **The address is the state.** `?order=<id>` is the chosen one, and a
  filter is a search parameter too, each typed by `validateSearch`.
  Nothing about what's chosen is in `useState`, so Back, a refresh and a
  shared link keep it.
- **`Panes`** (`shell.tsx`) takes `list`, `detail` and `chosen`. On a
  computer both show, the list 22rem wide. On a phone one shows: the list,
  until `chosen` is true, then the detail, with `BackToList` at its top.
- **Two things are called chosen.** What the right side draws is the one
  the address names, or the list's first, so on a computer that side is
  never empty. What `Panes` is told is whether the address names one, so
  a phone opens on the list.
- **A row is a `Link` to the same screen**, with the chosen one in its
  `search`, keeping the filter. The chosen row has `aria-current`, which
  its look hangs on.
- **The detail** is given only the id, with `key={id}` from the route, so
  it starts over for each one. It runs its own query and draws a skeleton
  in its shape while it loads, a line for a 404 (`failureOf`), and
  `CouldNotLoad` for anything else.

## The shared pieces

| File              | What it's for                                                                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `shell.tsx`       | The frame, `Navigation`, `shownTo`, `Panes`, `BackToList`, `NotPermitted`, `AdminNotFound`, `SinglePane`, `ListLoading`, `CouldNotLoad`, and the classes `textButton` and `sectionHeading` |
| `navigation.ts`   | The admin's sections, `ADMIN_NAVIGATION`, the Overview's and then this app's own, and `adminSectionAt`, the section an address is in                                                       |
| `app.ts`          | This app's own sections (`APP_NAVIGATION`) and parts of Settings (`APP_SETTINGS`), which no update from the template changes                                                               |
| `gate.tsx`        | What stands in front of the frame (above)                                                                                                                                                  |
| `prompt.tsx`      | A change only the code can make, for Claude Code: `CopyPrompt`, a button that copies one, `PromptChip`, a prompt in quotes that copies itself, and `Step`                                  |
| `marks.tsx`       | `RoleMark`, a role as a small mark, and `useNow()`, which draws a screen again every 15 seconds so "4 min ago" stays true                                                                  |
| `words.ts`        | How the dashboard says a time (`since`, `day`, `moment`), a browser (`describeBrowser`) and a role (`ROLE_NAMES`, `roleName`)                                                              |
| `permissions.tsx` | What a role may do, area by area: `AreaLevels` for one, `RoleLevels` for each role side by side                                                                                            |

- **`words.ts`** is where a screen gets its words, never a
  `toLocaleString` of its own. **A new role's name** goes in `ROLE_NAMES`,
  the one list every screen names a role from, and the typecheck fails
  until it does.

## Before it's done

A screen changes what a person sees, so `PRODUCT.md`, `DESIGN.md` and
`workbench/designing.md` apply to it as they do to a page. Every state is
drawn: loading as the screen's shape, never a spinner, a failure with a
way to try again, and an empty one that says what would fill it.
