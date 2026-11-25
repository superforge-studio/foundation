# Your files

Everything in the app's `Storage` bucket, under `/api/files`: **Your
files**, the team's own, which they upload, sort into folders, download,
send as a link and take to Trash; and **the folders the app keeps for
itself**, every other kind of file the code writes, which can be looked in
and downloaded from, never changed. No screen draws any of it as the
template ships: a script or an agent uses the routes, and an app that
wants a Files screen builds it on them ("What's left for an app", below).

## The model

- **A file is a row in `files`, and a folder a row in `file_folders`**
  (`database/schema/foundation.ts`). A file has its `name`, its
  `content_type` as its upload declared it, its `size` in bytes, the
  folder it's in (`folder_id`, null at the top), who uploaded it, and
  `updated_at`, when its name, folder or bytes last changed. A folder has
  its `name` and the folder it's in (`parent_id`).
- **A file's bytes are in the bucket under `files/<file id>`**, never its
  name (`Storage.files`, `database/storage/files.ts`). So a rename or a
  move changes a row and nothing in the bucket, a name is anything
  without a slash, and nothing makes one unique: two files in a folder
  can share a name.
- **`state` is `uploading` until the bytes are in, then `ready`**
  (`FILE_STATES`). Only a `ready` file is listed, found, downloaded,
  linked, renamed or taken to Trash.
- **Trash is `trashed_at`**, on a file or a folder, and only on the one
  taken there. A folder in Trash takes everything in it out of sight
  without touching their rows: every read walks up from a file or a
  folder to the top (`folderPath`, `find.ts`), and finds nothing when a
  folder on the way is in Trash.
- **Folders go 32 deep** (`DEEPEST`), which is where that walk stops.
  Making a folder past it, or moving one where it, or a folder inside it,
  would go deeper, is refused 409 `too-deep` (`levelsOf`, `find.ts`,
  counts the levels a move takes with it), so every folder there is can
  be opened.
- **A folder's row deleted takes its folders' rows with it** (`on delete
  cascade`), **but never a file's**: a folder with a file's row still in
  it can't be deleted (`on delete restrict`), since the file's bytes would
  stay in the bucket with nothing pointing at them, so whatever deletes
  folders deletes their files first, bytes then rows, as `emptyExpired`
  does. A user's deleted row leaves theirs, with `uploaded_by` and
  `created_by` null.

The operations are a file per verb: `create.ts` (`createFolder`,
`startUpload`), `find.ts` (`folderContents`, `findFile`, `findUpload`),
`change.ts` (`changeFolder`, `changeFile`, `finishUpload`), `trash.ts` and
`send.ts`, with `workflows.ts`'s `empty-trash`, which empties Trash on a
schedule.

## The routes

`routes.ts`. Every one takes `permitted("files")`.

| Method   | Path                                | What it does                                                                                                              |
| -------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/files/kinds`                      | The top of the bucket: each kind's `folder`, `name`, `about`, `access` and, when it's locked, `why`, and `unclaimed`      |
| `GET`    | `/files/trash`                      | Lists the `folders` and `files` taken there themselves, newest first                                                      |
| `GET`    | `/files/folders/:folder_id`         | A folder, or `root` for the top: `path`, the folders above it, its `folders`, each with how many `items`, and its `files` |
| `POST`   | `/files/folders`                    | `{ name, parent_id }`: a new folder, 201 `{ id }`, or 404 `no-folder`                                                     |
| `PATCH`  | `/files/folders/:folder_id`         | `{ name?, parent_id? }`: renames it, moves it, or both; 409 `into-itself` for a move into itself or a folder inside it    |
| `DELETE` | `/files/folders/:folder_id`         | To Trash, with everything in it                                                                                           |
| `POST`   | `/files/folders/:folder_id/restore` | Back from Trash: `{ to_top }`                                                                                             |
| `POST`   | `/files/uploads`                    | `{ folder_id, name, content_type, size }`: starts an upload, 201 `{ id, upload }`, where `upload` says where the bytes go |
| `PUT`    | `/files/uploads/:file_id`           | The bytes, to the server itself, in a dev server alone; 413 `too-large` past 100 MB, or past what was declared            |
| `POST`   | `/files/uploads/:file_id/done`      | The bytes are in: the file is `ready`; 409 `not-uploaded` or `too-large`                                                  |
| `GET`    | `/files/kept/:folder`               | A page of a folder the app keeps: `kind`, `files`, `folders` and `cursor`, from the top or `?under=`                      |
| `GET`    | `/files/kept/:folder/download`      | One of its files, by `?path=` as a listing gave it, with `inline=1` to show it in place                                   |
| `GET`    | `/files/:file_id/download`          | One of Your files, with `inline=1` to show it in place                                                                    |
| `POST`   | `/files/:file_id/link`              | A link that works for a week without logging in: `{ url, expires_at }`, or 409 `no-links` in a dev server                 |
| `PATCH`  | `/files/:file_id`                   | `{ name?, folder_id? }`: renames it, moves it, or both                                                                    |
| `DELETE` | `/files/:file_id`                   | To Trash                                                                                                                  |
| `POST`   | `/files/:file_id/restore`           | Back from Trash: `{ to_top }`                                                                                             |

What isn't there, hasn't finished uploading, or is in Trash is 404
`not-found`, a folder to put something in that isn't there is 404
`no-folder`, and a folder made or moved past 32 deep is 409 `too-deep`. A
folder's change takes a lock first (`changeFolder`, `change.ts`), so two
moves at once, each into the other, can't both pass their checks.
A listed file is its `id`, `folder_id`, `name`,
`content_type`, `size`, `created_at`, `updated_at` and `uploaded_by`,
which is the uploader's name, or their address, or null once they're gone.

## An upload

**In a build, the bytes never pass through the server:**

1. `POST /api/files/uploads` makes the row, `uploading`, with the size
   the client declared (`startUpload`), and answers `upload`, a form the
   bucket signed for this one file (`presignPost`):
   `{ method: "POST", url, fields }`. It works for 15 minutes, and the
   bucket holds it to the key `files/<id>`, the content type and no more
   bytes than were declared. It works those 15 minutes whatever `done`
   says, so until it runs out, the bytes of a file that's `ready` can be
   posted again, and its row's `size` not follow.
2. The browser posts a multipart form to `url`: each of `fields`, then
   the file itself, last, as `file`.
3. `POST /api/files/uploads/:file_id/done` asks the bucket what it has
   (`finishUpload`): nothing yet is 409 `not-uploaded`; more than was
   declared is deleted, 409 `too-large`; otherwise the row is `ready`,
   with the size the bucket has, and the file shows from then on.

**In a dev server, the server takes them.** Its folder can't sign a form,
so `upload` is `{ method: "PUT", url, fields: {} }`, with the route's own
`/api/files/uploads/<id>` for `url`: the client puts the bytes there, the
route reads them whole into memory and keeps them (`storage.files.put`),
and `done` is the same.

- **The `PUT` route is a dev server's alone.** Where the bucket can sign
  a form, as in a build, an upload goes straight to it, and the route is
  404 `not-found`, so the server never reads a file into memory there.
  Bytes kept through it are kept as `application/octet-stream`, the
  kind's own type: the file's type is its row's, whatever the `PUT` says,
  and a download says it.
- **Any `Content-Type` will do.** The API's check for another origin's
  requests (`workbench/writing-code.md`, "How a route fails") looks at
  the browser's `Origin` and `Sec-Fetch-Site`, never the body, so a
  script's `PUT` of a `.txt` file, or curl's `--data`, is taken.
- **Who's asking, and whether the upload is under way, are checked before
  the body is read**, and then up to 100 MB of it, so no one logged out,
  or with no upload to make, can make the server hold one. The API's own
  megabyte limit doesn't reach this route.
- **An upload never finished** stays `uploading`, shown nowhere, until
  Trash's emptying deletes it a day after it started.

## Downloads and links

`send.ts`'s `sendFile` hands over one of Your files and one of a kept
folder's alike.

- **In a build it's a redirect**, 302, to a link the bucket signed, good
  for five minutes (`DOWNLOAD_LINK_SECONDS`). The browser saves the file
  under its name, or with `inline=1` shows it in place. The server never
  holds the bytes, and for one of Your files the link is signed without
  asking the bucket whether they're there.
- **In a dev server the server streams it**, all of it or the range a
  `Range: bytes=…` header asks for (206, or 416). `inline=1` shows in
  place only what can't run: PNG, JPEG, GIF, WebP and AVIF images, video,
  audio, PDFs, plain text and CSV (`SHOWN_IN_PLACE`). Anything else, like
  an SVG or a page, downloads, with `Content-Security-Policy: sandbox`,
  since there it's at the app's own address. A row whose bytes are
  missing is 404 `no-bytes`, logged.
- **A link to send** (`POST /api/files/:file_id/link`) is the same kind
  of link, for seven days (`LINK_DAYS`), which saves the file under the
  name it had when the link was made. No row records one, so nothing
  lists them or takes one back: it works until it runs out, or the bytes
  are deleted, after its file goes to Trash (its bytes stay 30 days) and
  after its maker leaves the team. Nothing but rotating the bucket's keys
  ends one early. A dev server has none to give.

## Trash

- **To Trash, and back** (`trash.ts`): `trashFolder` and `trashFile` set
  `trashed_at`; `restoreFolder` and `restoreFile` clear it, and put the
  thing at the top when the folder it was in has gone to Trash since
  (`to_top`).
- **`GET /api/files/trash` lists what was taken there itself**
  (`listTrash`). What's inside a folder in Trash isn't listed, and comes
  back with it. Something taken to Trash before its folder followed isn't
  listed either while the folder is there, and still comes back by its
  own ID, to the top.
- **`emptyExpired` deletes for good**: each folder in Trash for 30 days
  (`TRASH_DAYS`), with every folder and file anywhere inside it, each file
  in Trash that long, and each upload still `uploading` a day after it
  started. A file's bytes go from the bucket first, then its row, so a
  failure part way leaves rows to try again with, never rows whose bytes
  are gone. At most 5,000 files a run, a thousand rows a delete, so no
  statement names more ids than Postgres takes; the rest, and their
  folders, wait for the next run.
- **The `empty-trash` workflow runs it each hour**, at a quarter past
  (`workflows.ts`), quiet, so its runs are listed (`/api/workflows/runs`)
  only when one fails, as `prune-webhook-deliveries` does its own prune
  (`backend/workflows/README.md`, "On a schedule"). So what has run out
  goes within the hour, whether anyone looks, and no route deletes
  anything for good: listing Trash, a `GET`, only reads.

## The folders the app keeps for itself

A kind of file the code writes and depends on is `locked`
(`workbench/writing-code.md`, "Data", has how a kind is written), and the
kept routes reach every locked kind in `Storage.kinds`, and no other. As
the template ships there's one, `visitor-salt`; `files` is the one kind
that's `open`.

- **`GET /api/files/kept/:folder`** lists a locked kind's folder, 200
  files and folders to a page, by their paths in the bucket: each file's
  `key`, `size` and `modified`, each folder's path, ending in `/`, and a
  `cursor` for the next page. `under` is a folder's path as a listing
  gave it, or the kind's own folder (`visitor-salt/`), which lists it as
  leaving `under` out does. A folder that's no locked kind's, `files`
  among them, an `under` outside the kind's, and one that's a file's path
  rather than a folder's, are 404.
- **`GET /api/files/kept/:folder/download`** sends one by its `path`, as
  Your files are sent.
- **Nothing changes them.** No route that changes anything is under
  `/files/kept` or `/files/kinds`, which a test holds
  (`tests/routes.test.ts`), and the routes that do write only to
  `files/<a row's ID>`. `Files.at(path)` (`database/storage/kind.ts`),
  which the kept routes read through, can read a file and never write
  one.
- **`unclaimed`**, from `GET /api/files/kinds`, names the folders at the
  top of the bucket that no kind claims (`Storage.unclaimed`): something
  wrote them outside the code's kinds, and nothing here reads them.

## The limits

| What                              | Is                            | Set in                                                        |
| --------------------------------- | ----------------------------- | ------------------------------------------------------------- |
| A file's size                     | 100 MB at most                | `largest_file`, the app's settings (`utilities/settings/`)    |
| How long something is in Trash    | 30 days                       | `trash_days`, the same settings                               |
| How long a link to send works     | 7 days                        | `link_days`, the same settings                                |
| A file's or a folder's name       | 1 to 255 characters, no slash | `item_name`, `source/utilities/schemas/files.ts`              |
| An upload's form                  | 15 minutes                    | `UPLOAD_FORM_SECONDS`, `routes.ts`                            |
| A download's link                 | 5 minutes                     | `DOWNLOAD_LINK_SECONDS`, `send.ts`                            |
| An upload never finished          | Deleted after a day           | `emptyExpired`, `trash.ts`                                    |
| How deep folders go               | 32                            | `DEEPEST`, `find.ts`                                          |
| A page of a kept folder           | 200                           | `routes.ts`                                                   |
| Any link or form the bucket signs | 90 days at most               | `LONGEST_PRESIGN_SECONDS`, `source/database/storage/index.ts` |

The schemas in `utilities/schemas/files.ts` are what the routes check
with, for a screen to check with too. `files.size` is a Postgres
`integer`, so a limit past 2 GB changes the column as well.

## Who may

Every route is in the `files` area (`source/utilities/permissions/`): a
`GET` needs `read`, and anything else `write`, the link to send among
them, since it's a `POST` (`workbench/writing-code.md`, "The team and
what each role may do"). An `owner` has it, and the template's `member`
is given `files: "write"` in `ACCESS`. There's no rule about which files:
whoever reaches the area reaches all of them.

## What's left for an app

- **A Files screen.** There's no page, component or query for these
  routes.
- **The bucket's CORS**, for a browser. A page that posts an upload's
  form, or reads a file's bytes with `fetch`, is calling the bucket from
  the app's address, which the bucket refuses until its CORS allows that
  address. The template sets none: a copy that needs it puts the rule
  through the bucket's S3 API (`PutBucketCors`) as each deploy goes out.
- **A kind of the app's own**, for a file the code writes, in
  `source/database/storage/app.ts`, not a row here.

## Testing

`testApi()` already runs the routes on a bucket in memory, and answers
what they kept as `files`. A test that needs the store itself hands its
own, as `tests/routes.test.ts` does:
`testApi({ storage: new Storage(memory.store) })`, with `memory` from
`memoryStore()` (`source/database/tests/support/storage.ts`). It signs
links that only name what they're for (`https://bucket.test/<key>?…`), so
a test reads what a route handed out, then does to the store what the
browser would have (`memory.store.put`). `memoryStore({ presigns: false })`
can't sign, as a dev server's folder can't.
