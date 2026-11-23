import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm"
import type { Database } from "@/database"
import { file_folders, files, users } from "@/database/schema"

// Reading Your files: a folder's contents and the folders above it, and one
// file. Something in Trash, or in a folder that is, isn't found, so a
// folder taken to Trash takes everything in it out of sight at once.

/** The most folders deep Your files go, which a walk up stops at. */
export const DEEPEST = 32

/**
 * The folders from the top down to `folder_id`, each with its name, or null
 * when it isn't there, or it or a folder above it is in Trash.
 */
export async function folderPath(database: Database, folder_id: string) {
    const path: { id: string; name: string }[] = []
    let next: string | null = folder_id
    while (next !== null) {
        if (path.length >= DEEPEST) {
            throw new Error(`Folder ${folder_id} is more than ${DEEPEST} deep`)
        }
        const [folder] = await database
            .select({
                id: file_folders.id,
                name: file_folders.name,
                parent_id: file_folders.parent_id,
                trashed_at: file_folders.trashed_at
            })
            .from(file_folders)
            .where(eq(file_folders.id, next))
        if (folder === undefined || folder.trashed_at !== null) {
            return null
        }
        path.unshift({ id: folder.id, name: folder.name })
        next = folder.parent_id
    }
    return path
}

/** A file's columns as the API answers them, with who uploaded it. */
export const file_columns = {
    id: files.id,
    folder_id: files.folder_id,
    name: files.name,
    content_type: files.content_type,
    size: files.size,
    created_at: files.created_at,
    updated_at: files.updated_at,
    // Their name, or their address when they haven't given one; null once
    // they've been removed
    uploaded_by: sql<string | null>`coalesce(${users.name}, ${users.email})`
}

/**
 * What's in a folder, or at the top for null: the folders, each with how
 * many things are in it, and the files that have finished uploading, each
 * by name, with the folders above it. Not found when the folder isn't, or
 * is in Trash.
 */
export async function folderContents(
    database: Database,
    folder_id: string | null
): AsyncOperationResult<
    {
        path: { id: string; name: string }[]
        folders: Awaited<ReturnType<typeof foldersIn>>
        files: Awaited<ReturnType<typeof filesIn>>
    },
    "not-found"
> {
    const path = folder_id === null ? [] : await folderPath(database, folder_id)
    if (path === null) {
        return { ok: false, error: "not-found" }
    } else {
        return {
            ok: true,
            data: {
                path,
                folders: await foldersIn(database, folder_id),
                files: await filesIn(database, folder_id)
            }
        }
    }
}

// The folders right in `folder_id`, out of Trash, by name, each with how
// many folders and finished files are in it
async function foldersIn(database: Database, folder_id: string | null) {
    const found = await database
        .select({
            id: file_folders.id,
            name: file_folders.name,
            created_at: file_folders.created_at
        })
        .from(file_folders)
        .where(
            and(
                folder_id === null
                    ? isNull(file_folders.parent_id)
                    : eq(file_folders.parent_id, folder_id),
                isNull(file_folders.trashed_at)
            )
        )
        .orderBy(asc(file_folders.name))
    if (found.length === 0) {
        return []
    }

    // What's in each, out of Trash: its folders, and its finished files
    const ids = found.map((folder) => folder.id)
    const inner_folders = await database
        .select({
            in: file_folders.parent_id,
            // count() answers a bigint, which pg hands over as a string
            count: sql<number>`count(*)::integer`
        })
        .from(file_folders)
        .where(
            and(
                inArray(file_folders.parent_id, ids),
                isNull(file_folders.trashed_at)
            )
        )
        .groupBy(file_folders.parent_id)
    const inner_files = await database
        .select({ in: files.folder_id, count: sql<number>`count(*)::integer` })
        .from(files)
        .where(
            and(
                inArray(files.folder_id, ids),
                isNull(files.trashed_at),
                eq(files.state, "ready")
            )
        )
        .groupBy(files.folder_id)
    const counted = (
        rows: { in: string | null; count: number }[],
        id: string
    ) => rows.find((row) => row.in === id)?.count ?? 0
    return found.map((folder) => ({
        ...folder,
        items:
            counted(inner_folders, folder.id) + counted(inner_files, folder.id)
    }))
}

// The files right in `folder_id` that have finished uploading, out of
// Trash, by name
async function filesIn(database: Database, folder_id: string | null) {
    return await database
        .select(file_columns)
        .from(files)
        .leftJoin(users, eq(users.id, files.uploaded_by))
        .where(
            and(
                folder_id === null
                    ? isNull(files.folder_id)
                    : eq(files.folder_id, folder_id),
                isNull(files.trashed_at),
                eq(files.state, "ready")
            )
        )
        .orderBy(asc(files.name))
}

/** A file in a folder, as the API lists it. */
export type ListedFile = Awaited<ReturnType<typeof filesIn>>[number]

/**
 * A file that has finished uploading, with the folders above it, or null
 * when it isn't there, is still uploading, or it or its folder is in Trash.
 */
export async function findFile(database: Database, file_id: string) {
    const [file] = await database
        .select({
            ...file_columns,
            state: files.state,
            trashed_at: files.trashed_at
        })
        .from(files)
        .leftJoin(users, eq(users.id, files.uploaded_by))
        .where(eq(files.id, file_id))
    if (
        file === undefined ||
        file.state !== "ready" ||
        file.trashed_at !== null
    ) {
        return null
    }
    const path =
        file.folder_id === null
            ? []
            : await folderPath(database, file.folder_id)
    if (path === null) {
        return null
    } else {
        const { state: _state, trashed_at: _trashed_at, ...shown } = file
        return { ...shown, path }
    }
}

/**
 * An upload under way, with the size it declared, or null when there's no
 * file uploading under that id.
 */
export async function findUpload(database: Database, file_id: string) {
    const [upload] = await database
        .select({ size: files.size })
        .from(files)
        .where(
            and(
                eq(files.id, file_id),
                eq(files.state, "uploading"),
                isNull(files.trashed_at)
            )
        )
    return upload ?? null
}
