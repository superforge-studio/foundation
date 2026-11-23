import { and, eq, isNull } from "drizzle-orm"
import type { Database } from "@/database"
import { file_folders, files } from "@/database/schema"
import type { Storage } from "@/database/storage"
import { now } from "@/database/time"
import { findFile, folderPath } from "./find"

// Changing what's in Your files: renaming and moving a folder or a file,
// and finishing a file's upload once its bytes are in the bucket. Each is a
// row's change: the bucket keeps a file's bytes under its id, whatever its
// name or folder.

/**
 * Renames a folder, or moves it into another (null for the top), or both.
 * Fails `not-found` for a folder that isn't there or is in Trash,
 * `no-folder` for a folder to move into that isn't, and `into-itself` for
 * a move into the folder itself or one inside it.
 */
export async function changeFolder(
    database: Database,
    input: { id: string; name?: string; parent_id?: string | null }
): AsyncOperationResult<null, "not-found" | "no-folder" | "into-itself"> {
    if ((await folderPath(database, input.id)) === null) {
        return { ok: false, error: "not-found" }
    }
    if (input.parent_id !== undefined && input.parent_id !== null) {
        const into = await folderPath(database, input.parent_id)
        if (into === null) {
            return { ok: false, error: "no-folder" }
        } else if (into.some((folder) => folder.id === input.id)) {
            return { ok: false, error: "into-itself" }
        }
    }
    await database
        .update(file_folders)
        .set({ name: input.name, parent_id: input.parent_id })
        .where(eq(file_folders.id, input.id))
    return { ok: true, data: null }
}

/**
 * Renames a file, or moves it into a folder (null for the top), or both.
 * Fails `not-found` for a file that isn't there, hasn't finished
 * uploading, or is in Trash, and `no-folder` for a folder that isn't.
 */
export async function changeFile(
    database: Database,
    input: { id: string; name?: string; folder_id?: string | null }
): AsyncOperationResult<null, "not-found" | "no-folder"> {
    if ((await findFile(database, input.id)) === null) {
        return { ok: false, error: "not-found" }
    }
    if (
        input.folder_id !== undefined &&
        input.folder_id !== null &&
        (await folderPath(database, input.folder_id)) === null
    ) {
        return { ok: false, error: "no-folder" }
    }
    await database
        .update(files)
        .set({ name: input.name, folder_id: input.folder_id, updated_at: now })
        .where(eq(files.id, input.id))
    return { ok: true, data: null }
}

/**
 * Marks a file's upload done once its bytes are in the bucket, taking its
 * size from what the bucket has. Fails `not-found` for a file that isn't
 * uploading, `not-uploaded` when the bucket has nothing for it yet, and
 * `too-large` for bytes past what was declared, which are deleted.
 */
export async function finishUpload(
    database: Database,
    storage: Storage,
    file_id: string
): AsyncOperationResult<null, "not-found" | "not-uploaded" | "too-large"> {
    const [file] = await database
        .select({ size: files.size })
        .from(files)
        .where(
            and(
                eq(files.id, file_id),
                eq(files.state, "uploading"),
                isNull(files.trashed_at)
            )
        )
    if (file === undefined) {
        return { ok: false, error: "not-found" }
    }
    const kept = await storage.files.head({ file_id })
    if (kept === null) {
        return { ok: false, error: "not-uploaded" }
    } else if (kept.size > file.size) {
        await storage.files.delete({ file_id })
        return { ok: false, error: "too-large" }
    } else {
        await database
            .update(files)
            .set({ state: "ready", size: kept.size, updated_at: now })
            .where(eq(files.id, file_id))
        return { ok: true, data: null }
    }
}
