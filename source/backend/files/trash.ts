import { and, asc, eq, inArray, isNotNull, lt } from "drizzle-orm"
import type { Database } from "@/database"
import { file_folders, files, users } from "@/database/schema"
import type { Storage } from "@/database/storage"
import { fromNow, now } from "@/database/time"
import { DAY } from "@/utilities/primitives/durations"
import { KEEP_TRASH_FOR } from "@/utilities/schemas/files"
import { DEEPEST, file_columns, findFile, folderPath } from "./find"

// Trash: a folder or a file taken out of sight, with everything in it, and
// back again, until it's been there 30 days, when it's deleted for good,
// its bytes from the bucket first. Uploads that never finished go the same
// way after a day. Railway's buckets have no lifecycle rules, so this does
// what one would (`emptyExpired`).

/** Takes a folder to Trash, with everything in it. */
export async function trashFolder(
    database: Database,
    folder_id: string
): AsyncOperationResult<null, "not-found"> {
    if ((await folderPath(database, folder_id)) === null) {
        return { ok: false, error: "not-found" }
    } else {
        await database
            .update(file_folders)
            .set({ trashed_at: now })
            .where(eq(file_folders.id, folder_id))
        return { ok: true, data: null }
    }
}

/** Takes a file to Trash. */
export async function trashFile(
    database: Database,
    file_id: string
): AsyncOperationResult<null, "not-found"> {
    if ((await findFile(database, file_id)) === null) {
        return { ok: false, error: "not-found" }
    } else {
        await database
            .update(files)
            .set({ trashed_at: now })
            .where(eq(files.id, file_id))
        return { ok: true, data: null }
    }
}

/**
 * Brings a folder back from Trash, with everything in it, to where it was,
 * or to the top when the folder it was in has gone to Trash itself since.
 * Answers whether it went to the top.
 */
export async function restoreFolder(
    database: Database,
    folder_id: string
): AsyncOperationResult<{ to_top: boolean }, "not-found"> {
    const [folder] = await database
        .select({ parent_id: file_folders.parent_id })
        .from(file_folders)
        .where(
            and(
                eq(file_folders.id, folder_id),
                isNotNull(file_folders.trashed_at)
            )
        )
    if (folder === undefined) {
        return { ok: false, error: "not-found" }
    }
    const to_top =
        folder.parent_id !== null &&
        (await folderPath(database, folder.parent_id)) === null
    await database
        .update(file_folders)
        .set({
            trashed_at: null,
            ...(to_top ? { parent_id: null } : {})
        })
        .where(eq(file_folders.id, folder_id))
    return { ok: true, data: { to_top } }
}

/** Brings a file back from Trash, as `restoreFolder` brings a folder. */
export async function restoreFile(
    database: Database,
    file_id: string
): AsyncOperationResult<{ to_top: boolean }, "not-found"> {
    const [file] = await database
        .select({ folder_id: files.folder_id })
        .from(files)
        .where(
            and(
                eq(files.id, file_id),
                isNotNull(files.trashed_at),
                eq(files.state, "ready")
            )
        )
    if (file === undefined) {
        return { ok: false, error: "not-found" }
    }
    const to_top =
        file.folder_id !== null &&
        (await folderPath(database, file.folder_id)) === null
    await database
        .update(files)
        .set({
            trashed_at: null,
            updated_at: now,
            ...(to_top ? { folder_id: null } : {})
        })
        .where(eq(files.id, file_id))
    return { ok: true, data: { to_top } }
}

/**
 * What's in Trash, newest first: each folder and file taken there itself,
 * not what went with a folder, which comes back with it.
 */
export async function listTrash(database: Database) {
    const trashed_folders = await database
        .select({
            id: file_folders.id,
            name: file_folders.name,
            parent_id: file_folders.parent_id,
            trashed_at: file_folders.trashed_at
        })
        .from(file_folders)
        .where(isNotNull(file_folders.trashed_at))
        .orderBy(asc(file_folders.trashed_at))
    const trashed_files = await database
        .select({ ...file_columns, trashed_at: files.trashed_at })
        .from(files)
        .leftJoin(users, eq(users.id, files.uploaded_by))
        .where(and(isNotNull(files.trashed_at), eq(files.state, "ready")))
        .orderBy(asc(files.trashed_at))

    // Only what was taken there itself: what's in a folder that's in Trash
    // too went with it. Trash is small, so each is checked a walk at a time
    const shown = {
        folders: [] as (typeof trashed_folders)[number][],
        files: [] as (typeof trashed_files)[number][]
    }
    for (const folder of trashed_folders) {
        if (
            folder.parent_id === null ||
            (await folderPath(database, folder.parent_id)) !== null
        ) {
            shown.folders.unshift(folder)
        }
    }
    for (const file of trashed_files) {
        if (
            file.folder_id === null ||
            (await folderPath(database, file.folder_id)) !== null
        ) {
            shown.files.unshift(file)
        }
    }
    return shown
}

/**
 * Deletes for good what's been in Trash for `KEEP_TRASH_FOR`, and uploads that
 * never finished in a day: each file's bytes from the bucket first, then
 * its row, so a failure part way leaves rows to try again with, never rows
 * whose bytes are gone. At most 5,000 files a run, the rest left for the
 * next, with their folders. Answers how many files went.
 */
export async function emptyExpired(database: Database, storage: Storage) {
    const before = fromNow(-KEEP_TRASH_FOR)

    // The folders gone for good, and every file anywhere inside them
    const expired_folders = await database
        .select({ id: file_folders.id })
        .from(file_folders)
        .where(lt(file_folders.trashed_at, before))
    const inside = await foldersUnder(
        database,
        expired_folders.map((folder) => folder.id)
    )
    const in_expired =
        inside.length === 0
            ? []
            : await database
                  .select({ id: files.id })
                  .from(files)
                  .where(inArray(files.folder_id, inside))

    // The files gone for good themselves, and the uploads never finished
    const expired_files = await database
        .select({ id: files.id })
        .from(files)
        .where(lt(files.trashed_at, before))
    const unfinished = await database
        .select({ id: files.id })
        .from(files)
        .where(
            and(
                eq(files.state, "uploading"),
                lt(files.created_at, fromNow(-DAY))
            )
        )

    // At most `MOST_A_RUN` files a run, each's bytes then the rows a
    // thousand at a time, so no statement names more ids than Postgres
    // takes; what's left waits for the next run, and the folders with it,
    // since a folder's row can't go while a file's row is in it
    const all = [
        ...new Set(
            [...in_expired, ...expired_files, ...unfinished].map(
                (file) => file.id
            )
        )
    ]
    const going = all.slice(0, MOST_A_RUN)
    for (let first = 0; first < going.length; first += ROWS_A_DELETE) {
        const batch = going.slice(first, first + ROWS_A_DELETE)
        for (const file_id of batch) {
            await storage.files.delete({ file_id })
        }
        await database.delete(files).where(inArray(files.id, batch))
    }
    if (all.length > going.length) {
        return going.length
    }
    if (expired_folders.length > 0) {
        // Each folder inside one goes with it (`on delete cascade`)
        await database.delete(file_folders).where(
            inArray(
                file_folders.id,
                expired_folders.map((folder) => folder.id)
            )
        )
    }
    return going.length
}

// The most files one run of emptying deletes, and how many rows each of
// its deletes names
const MOST_A_RUN = 5000
const ROWS_A_DELETE = 1000

// `folder_ids` and every folder inside them, however deep, a level at a time
async function foldersUnder(database: Database, folder_ids: string[]) {
    const found = [...folder_ids]
    let level = folder_ids
    for (let depth = 0; level.length > 0; depth += 1) {
        if (depth > DEEPEST) {
            throw new Error(`Folders in Trash are more than ${DEEPEST} deep`)
        }
        const children = await database
            .select({ id: file_folders.id })
            .from(file_folders)
            .where(inArray(file_folders.parent_id, level))
        level = children.map((child) => child.id)
        found.push(...level)
    }
    return found
}
