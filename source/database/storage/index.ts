import { join } from "node:path"
import { z } from "zod"
import { type BucketConfiguration, bucketStore } from "./bucket"
import { Storage } from "./files"
import { folderStore } from "./folder"

// The `Storage` bucket (.railway/railway.ts), through `Storage` (./files.ts):
// every kind of file the app keeps, each in a folder of its own, filed under
// a key its kind checks. Underneath it is an `ObjectStore`, bytes under
// keys: Railway's bucket through its S3 API in a build. A dev server has no
// credentials for it, so it keeps files in a folder on this machine instead,
// and the tests keep them in memory (../tests/support/storage.ts).

export { Storage } from "./files"

/** Bytes kept under keys, which only `Files` (./kind.ts) uses. */
export type ObjectStore = {
    /** Keeps `body` under `key`, in place of whatever was kept there. */
    put(
        key: string,
        body: string | Uint8Array<ArrayBuffer>,
        content_type: string
    ): Promise<void>
    /** The bytes kept under `key`, or null when nothing is. */
    get(key: string): Promise<Uint8Array<ArrayBuffer> | null>
    /**
     * What's kept under `key` as it streams, all of it or the bytes in
     * `range`, without holding it in memory: for a large file sent on to a
     * browser, like a video, which asks for it a range at a time.
     */
    open(
        key: string,
        range?: ByteRange
    ): AsyncOperationResult<Opened, OpenFailure>
    /** Deletes what's kept under `key`, if anything is. */
    delete(key: string): Promise<void>
    /**
     * A page of the files kept under `prefix`, in key order, each with its
     * size and when it was kept. With `folders`, the folders right under
     * `prefix` come back in place of what's inside them, as a screen of a
     * folder shows them. A page holds at most `limit` of the two together
     * (1,000 at most, and by default), and its `cursor` asks for the next.
     */
    list(prefix: string, options?: ListOptions): Promise<Listing>
    /** What's kept under `key`, without its bytes, or null when nothing is. */
    head(key: string): Promise<FileDetails | null>
    /**
     * A link that reads what's kept under `key` without credentials, for
     * `seconds`, so a browser fetches a file straight from the bucket. Only
     * the bucket can sign one: a dev server's folder fails
     * `not-presignable`, and its caller serves the file itself (`open`).
     */
    presignGet(
        key: string,
        options: PresignGetOptions
    ): AsyncOperationResult<string, PresignFailure>
    /**
     * A form a browser posts a file to, straight to the bucket, kept under
     * `key`: the bucket refuses any other key, content type or a file
     * larger than `max_bytes`. Fails `not-presignable` as `presignGet` does,
     * where the caller takes the file itself (`put`).
     */
    presignPost(
        key: string,
        options: PresignPostOptions
    ): AsyncOperationResult<PresignedPost, PresignFailure>
}

/**
 * Some of a file's bytes, from `start` to `end` inclusive, as an HTTP Range
 * header asks for them. Without an `end`, to the end of the file.
 */
export type ByteRange = { start: number; end?: number }

/**
 * A file being read: its bytes from `start` to `end` inclusive, of `size`
 * in all, and whether that's only part of it (a range, honored).
 */
export type Opened = {
    body: ReadableStream<Uint8Array>
    size: number
    start: number
    end: number
    partial: boolean
}

/** Nothing is kept under the key, or the range starts past its end. */
export type OpenFailure = "not-found" | "unsatisfiable"

/** Which page of a listing, and what's in it (`ObjectStore.list`). */
export type ListOptions = {
    folders?: boolean
    /** The last page's `cursor`, for the page after it. */
    cursor?: string
    limit?: number
}

/**
 * A page of a listing: its files, its folders (each a prefix ending in
 * `/`, when asked for), and the cursor for the next page, or null on the
 * last.
 */
export type Listing = {
    files: ListedFile[]
    folders: string[]
    cursor: string | null
}

/** A file in a listing: its key, its size in bytes, and when it was kept. */
export type ListedFile = { key: string; size: number; modified: Date }

/** What's kept under a key, without its bytes (`ObjectStore.head`). */
export type FileDetails = {
    size: number
    content_type: string
    modified: Date
}

/**
 * How long a link works, and, with `download`, the name a browser saves
 * the file under, in place of showing it.
 */
export type PresignGetOptions = { seconds: number; download?: string }

/**
 * How long the form works, what the file is, which the bucket keeps with
 * it, and the most bytes it takes.
 */
export type PresignPostOptions = {
    seconds: number
    content_type: string
    max_bytes: number
}

/**
 * Where a browser posts a file, and the fields it sends before it, in this
 * order, with the file last, as `file`.
 */
export type PresignedPost = { url: string; fields: Record<string, string> }

/** There's no bucket to sign for: a dev server keeps files in a folder. */
export type PresignFailure = "not-presignable"

/**
 * The longest a presigned link or form may work: Railway's buckets allow 90
 * days (docs.railway.com/storage-buckets/uploading-serving).
 */
export const LONGEST_PRESIGN_SECONDS = 90 * 24 * 60 * 60

/**
 * Where a dev server keeps its files: `.storage/` in the checkout it runs
 * from, which git ignores. Each checkout has its own, as it has its own
 * Postgres.
 */
export const LOCAL_STORAGE_DIRECTORY = join(process.cwd(), ".storage")

let shared: Storage | undefined

/**
 * The server's storage: the bucket whose S3 credentials Railway sets as
 * `STORAGE_*`, or the folder on this machine in a dev server. Made the
 * first time it's asked for, without checking the credentials: a server
 * missing them still answers, and only what keeps a file fails, saying
 * why.
 */
export function appStorage(): Storage {
    if (shared === undefined) {
        shared = new Storage(
            import.meta.env.DEV
                ? folderStore(LOCAL_STORAGE_DIRECTORY)
                : bucketStore(() => bucketConfiguration())
        )
    }
    return shared
}

// The bucket's S3 credentials, as Railway sets them on the app's service
// (.railway/railway.ts), by their variables' names
const storage_environment = z.object({
    STORAGE_BUCKET: z.string().min(1),
    STORAGE_ENDPOINT: z.url(),
    STORAGE_REGION: z.string().min(1),
    STORAGE_ACCESS_KEY_ID: z.string().min(1),
    STORAGE_SECRET_ACCESS_KEY: z.string().min(1)
})

/**
 * The bucket's credentials, from the environment, parsed with its schema.
 * Throws naming each of its variables that's missing or wrong.
 */
export function bucketConfiguration(
    environment: Record<string, string | undefined> = process.env
): BucketConfiguration {
    const parsed = storage_environment.safeParse(environment)
    if (!parsed.success) {
        const names = parsed.error.issues.map((issue) => issue.path.join("."))
        throw new Error(
            `The Storage bucket can't be used, since these aren't set right: ${names.join(", ")}`
        )
    } else {
        const variables = parsed.data
        return {
            bucket: variables.STORAGE_BUCKET,
            endpoint: variables.STORAGE_ENDPOINT,
            region: variables.STORAGE_REGION,
            access_key_id: variables.STORAGE_ACCESS_KEY_ID,
            secret_access_key: variables.STORAGE_SECRET_ACCESS_KEY
        }
    }
}
