import { z } from "zod"
import type {
    ByteRange,
    FileDetails,
    ListOptions,
    ObjectStore,
    Opened,
    OpenFailure,
    PresignFailure,
    PresignGetOptions
} from "."

// One kind of file the app keeps (files.ts): the folder its files go in, the
// key one is filed under, checked with zod before any path is made from it,
// where in the folder a key's file goes, and what's in it. So a route never
// writes a path by hand, and a missing id or a stray slash fails loudly
// rather than landing a file where no read will find it.

/** What a kind's files hold, and how it goes to and from the bucket's bytes. */
export type Format<Body> = {
    content_type: string
    encode(body: Body): string | Uint8Array<ArrayBuffer>
    decode(bytes: Uint8Array<ArrayBuffer>, path: string): Body
}

export type Kind<Key, Body> = {
    /** The kind's folder at the top of the bucket, like `invoices`. */
    folder: string
    /** How the kind shows on a screen of the bucket's folders. */
    shown: Shown
    /** What a file is filed under, like `{ customer_id, invoice_id }`. */
    key: z.ZodType<Key>
    /** Where a key's file goes in the folder, like `<customer id>/<invoice id>.pdf`. */
    path(key: Key): string
    content: Format<Body>
}

/**
 * How a kind shows on a screen of the bucket's folders, like Skyline's
 * Files: its name and a sentence on what it holds, for the people who look,
 * and whether they may change its files there. A kind whose files the code
 * writes and depends on is `locked`, and says why in a sentence a person
 * reads: the screen lets them look and download, never change it.
 */
export type Shown = { name: string; about: string } & (
    | { access: "open" }
    | { access: "locked"; why: string }
)

/**
 * A kind's file found by its path in the bucket, as a listing gives it,
 * rather than by its key: it can be read, never changed, so a screen that
 * shows what's in a folder can't write where its kind writes.
 */
export type FileByPath = {
    path: string
    head(): Promise<FileDetails | null>
    open(range?: ByteRange): AsyncOperationResult<Opened, OpenFailure>
    presignGet(
        options: PresignGetOptions
    ): AsyncOperationResult<string, PresignFailure>
}

/** The files of one kind: each filed under its key, in the kind's folder. */
export class Files<Key, Body> {
    constructor(
        private readonly store: ObjectStore,
        private readonly kind: Kind<Key, Body>
    ) {}

    /** The kind's folder at the top of the bucket. */
    get folder(): string {
        return this.kind.folder
    }

    /** How the kind shows on a screen of the bucket's folders. */
    get shown(): Shown {
        return this.kind.shown
    }

    /**
     * Where `key`'s file is in the bucket: the kind's folder, then its path.
     * Throws on a key that doesn't fit the kind, or a path with an empty,
     * `.` or `..` part.
     */
    path(key: Key): string {
        const path = `${this.kind.folder}/${this.kind.path(this.kind.key.parse(key))}`
        const parts = path.split("/")
        if (
            parts.some((part) => part === "" || part === "." || part === "..")
        ) {
            throw new Error(`A ${this.kind.folder} key made the path ${path}`)
        } else {
            return path
        }
    }

    /** Keeps `body` as `key`'s file, in place of any before it, and says where. */
    async put(key: Key, body: Body): Promise<string> {
        const path = this.path(key)
        await this.store.put(
            path,
            this.kind.content.encode(body),
            this.kind.content.content_type
        )
        return path
    }

    /** `key`'s file, or null when there isn't one. */
    async get(key: Key): Promise<Body | null> {
        const path = this.path(key)
        const bytes = await this.store.get(path)
        if (bytes === null) {
            return null
        } else {
            return this.kind.content.decode(bytes, path)
        }
    }

    /**
     * `key`'s file as it streams, all of it or the bytes in `range`, for
     * sending on as it is, like a video to a browser.
     */
    open(key: Key, range?: ByteRange) {
        return this.store.open(this.path(key), range)
    }

    /** Deletes `key`'s file, if there is one. */
    async delete(key: Key): Promise<void> {
        await this.store.delete(this.path(key))
    }

    /** What's kept as `key`'s file, without its bytes, or null when nothing is. */
    head(key: Key) {
        return this.store.head(this.path(key))
    }

    /**
     * A link that reads `key`'s file without credentials, for a browser to
     * fetch straight from the bucket (`ObjectStore.presignGet`).
     */
    presignGet(key: Key, options: PresignGetOptions) {
        return this.store.presignGet(this.path(key), options)
    }

    /**
     * A form a browser posts `key`'s file to, straight to the bucket
     * (`ObjectStore.presignPost`), of the kind's content type unless it
     * says otherwise, for a kind that keeps files of many types.
     */
    presignPost(
        key: Key,
        options: { seconds: number; max_bytes: number; content_type?: string }
    ) {
        return this.store.presignPost(this.path(key), {
            ...options,
            content_type: options.content_type ?? this.kind.content.content_type
        })
    }

    /**
     * Whether `path` is one of this kind's in the bucket: a file's, or a
     * folder's ending in `/`, inside the kind's folder, with no empty, `.` or
     * `..` part. For a path from a request, before it's listed or read.
     */
    holds(path: string): boolean {
        const parts = path.split("/")
        // A folder's path ends in `/`, so its last part is the empty one
        const named = path.endsWith("/") ? parts.slice(0, -1) : parts
        return (
            parts[0] === this.kind.folder &&
            named.length > 1 &&
            !named.some((part) => part === "" || part === "." || part === "..")
        )
    }

    /**
     * A page of the kind's files, by their paths in the bucket, with
     * `folders`, the folders right under `under` in place of what's inside
     * them. `under` is the kind's own folder unless it's one a listing gave.
     * Throws on an `under` the kind doesn't hold (`holds`).
     */
    list(options: ListOptions & { under?: string } = {}) {
        const { under = `${this.kind.folder}/`, ...page } = options
        if (under !== `${this.kind.folder}/` && !this.holds(under)) {
            throw new Error(`${under} isn't one of ${this.kind.folder}'s`)
        } else if (!under.endsWith("/")) {
            throw new Error(`${under} isn't a folder, which ends in /`)
        } else {
            return this.store.list(under, page)
        }
    }

    /**
     * One of the kind's files by its path in the bucket, as a listing gives
     * it, to read without its key, or null for a path the kind doesn't hold.
     */
    at(path: string): FileByPath | null {
        if (path.endsWith("/") || !this.holds(path)) {
            return null
        } else {
            return {
                path,
                head: () => this.store.head(path),
                open: (range) => this.store.open(path, range),
                presignGet: (options) => this.store.presignGet(path, options)
            }
        }
    }
}

/**
 * A JSON document, checked against `schema` as it's kept and as it's read
 * back. So a schema only grows the way a column does: a new field is
 * optional, or files kept before it fail to read.
 */
export function json<Body>(schema: z.ZodType<Body>): Format<Body> {
    return {
        content_type: "application/json",
        encode(body) {
            return JSON.stringify(schema.parse(body))
        },
        decode(bytes, path) {
            const read = schema.safeParse(
                JSON.parse(new TextDecoder().decode(bytes))
            )
            if (read.success) {
                return read.data
            } else {
                throw new Error(
                    `${path} doesn't hold what its kind says: ${z.prettifyError(read.error)}`
                )
            }
        }
    }
}

/** Text, like an email's HTML, of one content type (`text/html; charset=utf-8`). */
export function text(content_type: string): Format<string> {
    return {
        content_type,
        encode(body) {
            return body
        },
        decode(bytes) {
            return new TextDecoder().decode(bytes)
        }
    }
}

/** Bytes as they came, like a PDF or an image, of one content type. */
export function bytes(content_type: string): Format<Uint8Array<ArrayBuffer>> {
    return {
        content_type,
        encode(body) {
            return body
        },
        decode(body) {
            return body
        }
    }
}
