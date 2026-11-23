import { and, asc, eq, inArray, isNull } from "drizzle-orm"
import type { Database } from "@/database"
import { file_folders, files, users } from "@/database/schema"
import type { Storage } from "@/database/storage"
import { fromNow } from "@/database/time"
import { DAY, HOUR } from "@/utilities/primitives/durations"
import type { Seeder } from "./seed"

// Sample folders and files for Your files (backend/files/): the top, with
// folders of a few kinds, one inside another, files of each type a preview
// shows, one upload never finished and one folder and one file in Trash.
// Each file's bytes are made here too (`SAMPLE_BYTES`), which
// `seedLocalDatabase` puts in this checkout's `.storage/`, so a dev server
// previews and downloads them.

// A tiny PDF, one page with a line of text, which a browser's viewer opens
const PDF = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length 74 >> stream
BT /F1 24 Tf 72 700 Td (Service agreement: a sample, not a contract.) Tj ET
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
trailer << /Root 1 0 R >>
%%EOF
`

const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" rx="24" fill="#1f2937"/><circle cx="60" cy="60" r="30" fill="#f59e0b"/></svg>
`

const PRICES = `Service,Price,Unit
Standard visit,95,per visit
Deep clean,240,per job
Callout fee,45,per call
`

const NOTES = `Insurance renewal is due in March. The broker's number is on the policy.
`

/** Each sample file's bytes, by its name. */
export const SAMPLE_BYTES: Record<string, string> = {
    "Service agreement - sample.pdf": PDF,
    "Logo.svg": LOGO,
    "Price list 2026.csv": PRICES,
    "Insurance notes.txt": NOTES,
    "Old price list.csv": PRICES
}

/** The folders, then the files in them, and what's in Trash. */
export const seedFolders: Seeder = async (transaction) => {
    await transaction.delete(file_folders)
    const by = await firstInternal(transaction)
    const [contracts, logos, photos, old_quotes] = await transaction
        .insert(file_folders)
        .values([
            {
                name: "Contracts",
                created_by: by,
                created_at: fromNow(-40 * DAY)
            },
            { name: "Logos", created_by: by, created_at: fromNow(-38 * DAY) },
            {
                name: "Job photos",
                created_by: by,
                created_at: fromNow(-20 * DAY)
            },
            {
                name: "Old quotes",
                created_by: by,
                created_at: fromNow(-60 * DAY),
                trashed_at: fromNow(-3 * DAY)
            }
        ])
        .returning({ id: file_folders.id })
    if (
        contracts === undefined ||
        logos === undefined ||
        photos === undefined ||
        old_quotes === undefined
    ) {
        throw new Error("The sample folders didn't come back")
    }
    await transaction.insert(file_folders).values({
        name: "Before and after",
        parent_id: photos.id,
        created_by: by,
        created_at: fromNow(-12 * DAY)
    })
    return { table: "file_folders", rows: 5 }
}

export const seedFiles: Seeder = async (transaction) => {
    await transaction.delete(files)
    const by = await firstInternal(transaction)
    const size = (name: string) =>
        new TextEncoder().encode(SAMPLE_BYTES[name] ?? "").length
    // The folders `seedFolders` made, by name
    const made = await transaction
        .select({ id: file_folders.id, name: file_folders.name })
        .from(file_folders)
    const folder = (name: string) =>
        made.find((each) => each.name === name)?.id ?? null
    const rows = await transaction
        .insert(files)
        .values([
            {
                folder_id: folder("Contracts"),
                name: "Service agreement - sample.pdf",
                content_type: "application/pdf",
                size: size("Service agreement - sample.pdf"),
                state: "ready" as const,
                uploaded_by: by,
                created_at: fromNow(-30 * DAY),
                updated_at: fromNow(-30 * DAY)
            },
            {
                folder_id: folder("Logos"),
                name: "Logo.svg",
                content_type: "image/svg+xml",
                size: size("Logo.svg"),
                state: "ready" as const,
                uploaded_by: by,
                created_at: fromNow(-38 * DAY),
                updated_at: fromNow(-38 * DAY)
            },
            {
                folder_id: null,
                name: "Price list 2026.csv",
                content_type: "text/csv",
                size: size("Price list 2026.csv"),
                state: "ready" as const,
                uploaded_by: by,
                created_at: fromNow(-2 * DAY),
                updated_at: fromNow(-2 * DAY)
            },
            {
                folder_id: null,
                name: "Insurance notes.txt",
                content_type: "text/plain",
                size: size("Insurance notes.txt"),
                state: "ready" as const,
                uploaded_by: null,
                created_at: fromNow(-9 * DAY),
                updated_at: fromNow(-9 * DAY)
            },
            {
                folder_id: null,
                name: "Old price list.csv",
                content_type: "text/csv",
                size: size("Old price list.csv"),
                state: "ready" as const,
                uploaded_by: by,
                created_at: fromNow(-70 * DAY),
                updated_at: fromNow(-70 * DAY),
                trashed_at: fromNow(-5 * DAY)
            },
            {
                // An upload that never finished, which shows nowhere
                folder_id: null,
                name: "Truck lease.pdf",
                content_type: "application/pdf",
                size: 2_400_000,
                state: "uploading" as const,
                uploaded_by: by,
                created_at: fromNow(-1 * HOUR),
                updated_at: fromNow(-1 * HOUR)
            }
        ])
        .returning({ id: files.id })
    return { table: "files", rows: rows.length }
}

/**
 * Keeps each sample file's bytes where `storage` keeps files, under its
 * row's ID, as an upload would have: what `seedLocalDatabase` runs after
 * the seed, with this checkout's `.storage/`. Answers how many it kept.
 */
export async function keepSampleFiles(database: Database, storage: Storage) {
    const sample = await database
        .select({ id: files.id, name: files.name })
        .from(files)
        .where(
            and(
                eq(files.state, "ready"),
                inArray(files.name, Object.keys(SAMPLE_BYTES))
            )
        )
    for (const file of sample) {
        await storage.files.put(
            { file_id: file.id },
            new TextEncoder().encode(SAMPLE_BYTES[file.name] ?? "")
        )
    }
    return sample.length
}

// The first of the team, by when they joined, who made the
// sample folders and files, or null when none is listed
async function firstInternal(transaction: Parameters<Seeder>[0]) {
    const [owner] = await transaction
        .select({ id: users.id })
        .from(users)
        .where(isNull(users.deactivated_at))
        .orderBy(asc(users.created_at))
        .limit(1)
    return owner?.id ?? null
}
