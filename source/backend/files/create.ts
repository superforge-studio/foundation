import type { Database } from "@/database"
import { file_folders, files } from "@/database/schema"
import { DEEPEST, folderPath } from "./find"

// Making things in Your files: a folder, and the row a file's upload starts
// with, before its bytes reach the bucket.

/**
 * A new folder in `parent_id`, or at the top for null. Fails `no-folder`
 * when the folder it goes in isn't there, or is in Trash, and `too-deep`
 * when it would be more than `DEEPEST` folders deep.
 */
export async function createFolder(
    database: Database,
    input: { name: string; parent_id: string | null; by: string }
): AsyncOperationResult<{ id: string }, "no-folder" | "too-deep"> {
    const above =
        input.parent_id === null
            ? []
            : await folderPath(database, input.parent_id)
    if (above === null) {
        return { ok: false, error: "no-folder" }
    } else if (above.length + 1 > DEEPEST) {
        return { ok: false, error: "too-deep" }
    } else {
        const [made] = await database
            .insert(file_folders)
            .values({
                name: input.name,
                parent_id: input.parent_id,
                created_by: input.by
            })
            .returning({ id: file_folders.id })
        if (made === undefined) {
            throw new Error("The new folder's row didn't come back")
        } else {
            return { ok: true, data: made }
        }
    }
}

/**
 * The row a file's upload starts with, `uploading`, its size as the
 * browser declared it, which the bucket then holds it to. It shows nowhere
 * until its upload is done (change.ts's `finishUpload`). Fails `no-folder`
 * as `createFolder` does.
 */
export async function startUpload(
    database: Database,
    input: {
        folder_id: string | null
        name: string
        content_type: string
        size: number
        by: string
    }
): AsyncOperationResult<{ id: string }, "no-folder"> {
    if (
        input.folder_id !== null &&
        (await folderPath(database, input.folder_id)) === null
    ) {
        return { ok: false, error: "no-folder" }
    } else {
        const [made] = await database
            .insert(files)
            .values({
                folder_id: input.folder_id,
                name: input.name,
                content_type: input.content_type,
                size: input.size,
                uploaded_by: input.by
            })
            .returning({ id: files.id })
        if (made === undefined) {
            throw new Error("The new file's row didn't come back")
        } else {
            return { ok: true, data: made }
        }
    }
}
