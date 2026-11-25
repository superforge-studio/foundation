import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { z } from "zod"
import { DAY, MINUTE } from "@/utilities/primitives/durations"
import {
    file_change,
    file_id,
    folder_change,
    folder_creation,
    folder_id,
    LARGEST_FILE,
    LARGEST_FILE_WORDS,
    LINK_DAYS,
    upload_start
} from "@/utilities/schemas/files"
import { permitted } from "../auth/logged-in"
import type { ApiEnvironment } from "../context"
import { failure, validated } from "../failures"
import { changeFile, changeFolder, finishUpload } from "./change"
import { createFolder, startUpload } from "./create"
import { DEEPEST, findFile, findUpload, folderContents } from "./find"
import { sendFile } from "./send"
import {
    listTrash,
    restoreFile,
    restoreFolder,
    trashFile,
    trashFolder
} from "./trash"

// A file's or a folder's ID in a path, or `root` for the top of Your files
const file_path = z.object({ file_id })
const folder_path = z.object({ folder_id })
const place_path = z.object({
    folder_id: z.union([z.literal("root"), folder_id])
})

// A kept folder in a path, and where in it, a page at a time
const kept_path = z.object({ folder: z.string().min(1).max(64) })
const kept_listing = z.object({
    under: z.string().max(1024).optional(),
    cursor: z.string().max(1024).optional()
})
const kept_file = z.object({
    path: z.string().min(1).max(1024),
    inline: z.literal("1").optional()
})
const inline_query = z.object({ inline: z.literal("1").optional() })

/** How long an upload's form works. */
const UPLOAD_FORM_SECONDS = (15 * MINUTE) / 1000

/**
 * Everything in the app's bucket, under /api/files, for a script, an
 * agent, or a Files screen a copy builds on it: Your files, the team's
 * own, in folders kept in Postgres, which the business's own people
 * upload, rename, move, take to Trash and bring back;
 * and the folders the app keeps for itself (`Storage.kinds`, locked),
 * which they can look in and download from, and nothing more. No route
 * here writes anywhere but under `files/`: that's the lock.
 */
export const fileRoutes = new Hono<ApiEnvironment>()
    // The top of the bucket: each kind with how it shows, and the folders
    // no kind claims, which nothing in the code reads
    .get("/files/kinds", permitted("files"), async (context) => {
        const kinds = context.var.storage.kinds.map((kind) => ({
            folder: kind.folder,
            ...kind.shown
        }))
        const unclaimed = await context.var.storage.unclaimed()
        return context.json({ kinds, unclaimed }, 200)
    })

    // What's in Trash, which the `empty-trash` workflow empties of what's
    // been there 30 days, each hour (workflows.ts)
    .get("/files/trash", permitted("files"), async (context) => {
        const trash = await listTrash(context.var.database)
        return context.json(trash, 200)
    })

    // A folder of Your files, or `root` for the top: the folders above it,
    // and its folders and files
    .get(
        "/files/folders/:folder_id",
        permitted("files"),
        validated("param", place_path),
        async (context) => {
            const { folder_id } = context.req.valid("param")
            const contents = await folderContents(
                context.var.database,
                folder_id === "root" ? null : folder_id
            )
            if (contents.ok) {
                return context.json(contents.data, 200)
            } else {
                return failure(context, 404, contents.error, "No such folder")
            }
        }
    )

    .post(
        "/files/folders",
        permitted("files"),
        validated("json", folder_creation),
        async (context) => {
            const made = await createFolder(context.var.database, {
                ...context.req.valid("json"),
                by: context.var.user.id
            })
            if (made.ok) {
                return context.json(made.data, 201)
            } else if (made.error === "too-deep") {
                return failure(
                    context,
                    409,
                    made.error,
                    `Folders go at most ${DEEPEST} deep`
                )
            } else {
                return failure(
                    context,
                    404,
                    made.error,
                    "The folder it goes in isn't there"
                )
            }
        }
    )

    // A folder renamed, or moved into another, or both
    .patch(
        "/files/folders/:folder_id",
        permitted("files"),
        validated("param", folder_path),
        validated("json", folder_change),
        async (context) => {
            const { folder_id } = context.req.valid("param")
            const changed = await changeFolder(context.var.database, {
                id: folder_id,
                ...context.req.valid("json")
            })
            if (changed.ok) {
                return context.json({ changed: true as const }, 200)
            } else if (changed.error === "into-itself") {
                return failure(
                    context,
                    409,
                    changed.error,
                    "A folder can't go inside itself"
                )
            } else if (changed.error === "too-deep") {
                return failure(
                    context,
                    409,
                    changed.error,
                    `Folders go at most ${DEEPEST} deep`
                )
            } else if (changed.error === "no-folder") {
                return failure(
                    context,
                    404,
                    changed.error,
                    "The folder it goes in isn't there"
                )
            } else {
                return failure(context, 404, changed.error, "No such folder")
            }
        }
    )

    // A folder to Trash, with everything in it, and back
    .delete(
        "/files/folders/:folder_id",
        permitted("files"),
        validated("param", folder_path),
        async (context) => {
            const { folder_id } = context.req.valid("param")
            const trashed = await trashFolder(context.var.database, folder_id)
            if (trashed.ok) {
                return context.json({ trashed: true as const }, 200)
            } else {
                return failure(context, 404, trashed.error, "No such folder")
            }
        }
    )
    .post(
        "/files/folders/:folder_id/restore",
        permitted("files"),
        validated("param", folder_path),
        async (context) => {
            const { folder_id } = context.req.valid("param")
            const restored = await restoreFolder(
                context.var.database,
                folder_id
            )
            if (restored.ok) {
                return context.json(restored.data, 200)
            } else {
                return failure(
                    context,
                    404,
                    restored.error,
                    "No such folder in Trash"
                )
            }
        }
    )

    // An upload starts: the file's row, and where the browser sends its
    // bytes, straight to the bucket on a form that holds it to this file's
    // key, type and size, or, in a dev server, to the route below
    .post(
        "/files/uploads",
        permitted("files"),
        validated("json", upload_start),
        async (context) => {
            const { database, storage } = context.var
            const input = context.req.valid("json")
            const started = await startUpload(database, {
                ...input,
                by: context.var.user.id
            })
            if (!started.ok) {
                return failure(
                    context,
                    404,
                    started.error,
                    "The folder it goes in isn't there"
                )
            }
            const { id } = started.data
            const form = await storage.files.presignPost(
                { file_id: id },
                {
                    seconds: UPLOAD_FORM_SECONDS,
                    max_bytes: Math.max(1, input.size),
                    content_type: input.content_type
                }
            )
            return context.json(
                {
                    id,
                    upload: form.ok
                        ? {
                              method: "POST" as const,
                              url: form.data.url,
                              fields: form.data.fields
                          }
                        : {
                              method: "PUT" as const,
                              url: `/api/files/uploads/${id}`,
                              fields: {}
                          }
                },
                201
            )
        }
    )

    // A file's bytes, to the server itself: where a dev server, whose
    // folder can't sign a form, sends an upload. Where the bucket can sign
    // one, as in a build, an upload goes straight to it, and this is 404.
    // Who's asking, and whether there's an upload to take, are checked
    // before the body is read, so no one can make the server hold one for
    // nothing; the API's own limit doesn't reach this route (index.ts)
    .put(
        "/files/uploads/:file_id",
        permitted("files"),
        validated("param", file_path),
        async (context, next) => {
            const { file_id } = context.req.valid("param")
            const upload = await uploadTaken(context.var, file_id)
            if (upload === null) {
                return failure(
                    context,
                    404,
                    "not-found",
                    "No such upload under way"
                )
            } else {
                await next()
            }
        },
        bodyLimit({
            maxSize: LARGEST_FILE,
            onError: (context) =>
                failure(
                    context,
                    413,
                    "too-large",
                    `A file is at most ${LARGEST_FILE_WORDS}`
                )
        }),
        async (context) => {
            const { file_id } = context.req.valid("param")
            const upload = await uploadTaken(context.var, file_id)
            if (upload === null) {
                return failure(
                    context,
                    404,
                    "not-found",
                    "No such upload under way"
                )
            }
            const bytes = new Uint8Array(await context.req.arrayBuffer())
            if (bytes.length > upload.size) {
                return failure(
                    context,
                    413,
                    "too-large",
                    "The file is larger than it said"
                )
            } else {
                await context.var.storage.files.put({ file_id }, bytes)
                return context.json({ kept: true as const }, 200)
            }
        }
    )

    // An upload's bytes are in: the file shows from now on
    .post(
        "/files/uploads/:file_id/done",
        permitted("files"),
        validated("param", file_path),
        async (context) => {
            const { file_id } = context.req.valid("param")
            const finished = await finishUpload(
                context.var.database,
                context.var.storage,
                file_id
            )
            if (finished.ok) {
                return context.json({ done: true as const }, 200)
            } else if (finished.error === "not-uploaded") {
                return failure(
                    context,
                    409,
                    finished.error,
                    "The file's bytes haven't arrived yet"
                )
            } else if (finished.error === "too-large") {
                return failure(
                    context,
                    409,
                    finished.error,
                    "The file was larger than it said"
                )
            } else {
                return failure(
                    context,
                    404,
                    finished.error,
                    "No such upload under way"
                )
            }
        }
    )

    // A folder the app keeps for itself, a page at a time: its own top, or
    // a folder in it a listing gave (`under`)
    .get(
        "/files/kept/:folder",
        permitted("files"),
        validated("param", kept_path),
        validated("query", kept_listing),
        async (context) => {
            const { folder } = context.req.valid("param")
            const { under, cursor } = context.req.valid("query")
            const kind = keptKind(context.var.storage.kinds, folder)
            if (kind === undefined) {
                return failure(
                    context,
                    404,
                    "not-found",
                    "No folder the app keeps is called that"
                )
            } else if (
                under !== undefined &&
                under !== `${kind.folder}/` &&
                !(under.endsWith("/") && kind.holds(under))
            ) {
                return failure(
                    context,
                    404,
                    "not-found",
                    "That isn't a folder of this one's"
                )
            }
            const listing = await kind.list({
                folders: true,
                limit: 200,
                under,
                cursor
            })
            return context.json(
                {
                    kind: { folder: kind.folder, ...kind.shown },
                    files: listing.files,
                    folders: listing.folders,
                    cursor: listing.cursor
                },
                200
            )
        }
    )

    // One of a kept folder's files, by the path its listing gave: a
    // download, or with `inline`, shown in place
    .get(
        "/files/kept/:folder/download",
        permitted("files"),
        validated("param", kept_path),
        validated("query", kept_file),
        async (context) => {
            const { folder } = context.req.valid("param")
            const { path, inline } = context.req.valid("query")
            const file = keptKind(context.var.storage.kinds, folder)?.at(path)
            const details = await file?.head()
            if (file === undefined || file === null || details === null) {
                return failure(context, 404, "not-found", "No such file")
            } else {
                return await sendFile(
                    context,
                    {
                        name: path.split("/").at(-1) ?? path,
                        content_type:
                            details?.content_type ?? "application/octet-stream",
                        presignGet: file.presignGet,
                        open: file.open
                    },
                    inline === "1"
                )
            }
        }
    )

    // One of Your files: a download, or with `inline`, shown in place
    .get(
        "/files/:file_id/download",
        permitted("files"),
        validated("param", file_path),
        validated("query", inline_query),
        async (context) => {
            const { file_id } = context.req.valid("param")
            const file = await findFile(context.var.database, file_id)
            if (file === null) {
                return failure(context, 404, "not-found", "No such file")
            }
            const files = context.var.storage.files
            return await sendFile(
                context,
                {
                    name: file.name,
                    content_type: file.content_type,
                    presignGet: (options) =>
                        files.presignGet({ file_id }, options),
                    open: (range) => files.open({ file_id }, range)
                },
                context.req.valid("query").inline === "1"
            )
        }
    )

    // A link to one of Your files that works for a week without logging
    // in, for sending to someone outside the team
    .post(
        "/files/:file_id/link",
        permitted("files"),
        validated("param", file_path),
        async (context) => {
            const { file_id } = context.req.valid("param")
            const file = await findFile(context.var.database, file_id)
            if (file === null) {
                return failure(context, 404, "not-found", "No such file")
            }
            const link = await context.var.storage.files.presignGet(
                { file_id },
                { seconds: (LINK_DAYS * DAY) / 1000, download: file.name }
            )
            if (link.ok) {
                return context.json(
                    {
                        url: link.data,
                        expires_at: new Date(
                            Date.now() + LINK_DAYS * DAY
                        ).toISOString()
                    },
                    200
                )
            } else {
                return failure(
                    context,
                    409,
                    "no-links",
                    "Links come from the bucket, and a dev server keeps files on this computer"
                )
            }
        }
    )

    // A file renamed, or moved into a folder, or both
    .patch(
        "/files/:file_id",
        permitted("files"),
        validated("param", file_path),
        validated("json", file_change),
        async (context) => {
            const { file_id } = context.req.valid("param")
            const changed = await changeFile(context.var.database, {
                id: file_id,
                ...context.req.valid("json")
            })
            if (changed.ok) {
                return context.json({ changed: true as const }, 200)
            } else if (changed.error === "no-folder") {
                return failure(
                    context,
                    404,
                    changed.error,
                    "The folder it goes in isn't there"
                )
            } else {
                return failure(context, 404, changed.error, "No such file")
            }
        }
    )

    // A file to Trash, and back
    .delete(
        "/files/:file_id",
        permitted("files"),
        validated("param", file_path),
        async (context) => {
            const { file_id } = context.req.valid("param")
            const trashed = await trashFile(context.var.database, file_id)
            if (trashed.ok) {
                return context.json({ trashed: true as const }, 200)
            } else {
                return failure(context, 404, trashed.error, "No such file")
            }
        }
    )
    .post(
        "/files/:file_id/restore",
        permitted("files"),
        validated("param", file_path),
        async (context) => {
            const { file_id } = context.req.valid("param")
            const restored = await restoreFile(context.var.database, file_id)
            if (restored.ok) {
                return context.json(restored.data, 200)
            } else {
                return failure(
                    context,
                    404,
                    restored.error,
                    "No such file in Trash"
                )
            }
        }
    )

// A kind the app keeps for itself, by its folder: never Your files, which
// the routes above reach only through Postgres
function keptKind<Kind extends { folder: string; shown: { access: string } }>(
    kinds: Kind[],
    folder: string
) {
    return kinds.find(
        (kind) => kind.folder === folder && kind.shown.access === "locked"
    )
}

// The upload under way for `file_id` that the server itself takes the bytes
// of, or null: none where the bucket can sign a form, as in a build, whose
// uploads go straight to it
async function uploadTaken(
    { storage, database }: ApiEnvironment["Variables"],
    file_id: string
) {
    const signs = await storage.files.presignPost(
        { file_id },
        { seconds: UPLOAD_FORM_SECONDS, max_bytes: 1 }
    )
    return signs.ok ? null : await findUpload(database, file_id)
}
