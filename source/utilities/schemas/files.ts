import { z } from "zod"
import { SETTINGS } from "../settings"
import { isStorable } from "./text"
// Relative, since drizzle-kit reads this file through schema.ts, without
// the app's `@/` paths

// Your files (backend/files/): what a request to their routes sends and
// the routes check, so a screen built on them checks with the same
// schemas, on both sides.

/** Whether a file's bytes have reached the bucket yet. */
export const FILE_STATES = ["uploading", "ready"] as const

/**
 * The largest file anyone uploads, in bytes, as the app's settings say
 * (`largest_file`, utilities/settings/): 100 MB, as the template ships.
 */
export const LARGEST_FILE = SETTINGS.largest_file

/** The largest file, as a person reads it: "100 MB". */
export const LARGEST_FILE_WORDS = `${Math.round(LARGEST_FILE / (1024 * 1024))} MB`

/** How long a file stays in Trash before it's deleted for good. */
export const KEEP_TRASH_FOR = SETTINGS.keep_trash_for

/** How long a link from "Copy a link" works. */
export const LINKS_LAST_FOR = SETTINGS.links_last_for

/**
 * A file's or a folder's name: trimmed, something, at most 255 characters,
 * and no slash, which would read as a folder in a path.
 */
export const item_name = z
    .string()
    .trim()
    .min(1, "Give it a name")
    .max(255, "That name is too long")
    .refine((name) => !name.includes("/"), "A name can't have a slash")
    .refine(isStorable, "A name can't have that character")

/** A folder's ID, and a file's. */
export const folder_id = z.uuid()
export const file_id = z.uuid()

/** Where something goes: a folder's ID, or null for the top of Your files. */
export const folder_place = folder_id.nullable()

/** A new folder, in a folder or at the top. */
export const folder_creation = z.object({
    name: item_name,
    parent_id: folder_place
})

/** A folder's new name, or the folder it moves into, or both. */
export const folder_change = z
    .object({ name: item_name.optional(), parent_id: folder_place.optional() })
    .refine(
        (change) => change.name !== undefined || change.parent_id !== undefined,
        "Say what changes"
    )

/** A file's new name, or the folder it moves into, or both. */
export const file_change = z
    .object({ name: item_name.optional(), folder_id: folder_place.optional() })
    .refine(
        (change) => change.name !== undefined || change.folder_id !== undefined,
        "Say what changes"
    )

/** A file about to be uploaded: where it goes, its name, type and size. */
export const upload_start = z.object({
    folder_id: folder_place,
    name: item_name,
    content_type: z
        .string()
        .trim()
        .max(255)
        .transform((type) => (type === "" ? "application/octet-stream" : type)),
    size: z
        .number()
        .int()
        .min(0)
        .max(LARGEST_FILE, `A file can be at most ${LARGEST_FILE_WORDS}`)
})
