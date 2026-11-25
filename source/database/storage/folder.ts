import { createReadStream } from "node:fs"
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { dirname, join, relative, sep } from "node:path"
import type { ListedFile, ObjectStore } from "."
import { pageOf } from "./listing"

/**
 * Files kept in a folder on this machine, for a dev server, which has no
 * credentials for Railway's bucket: each key a path under `directory`.
 */
export function folderStore(directory: string): ObjectStore {
    function pathOf(key: string) {
        const parts = key.split("/")
        if (
            parts.some((part) => part === "" || part === "." || part === "..")
        ) {
            throw new Error(`A Storage key can't name a path like ${key}`)
        } else {
            return join(directory, ...parts)
        }
    }

    return {
        async put(key, body) {
            const path = pathOf(key)
            await mkdir(dirname(path), { recursive: true })
            await writeFile(path, body)
        },

        async get(key) {
            try {
                return new Uint8Array(await readFile(pathOf(key)))
            } catch (error) {
                if (
                    error instanceof Error &&
                    "code" in error &&
                    error.code === "ENOENT"
                ) {
                    return null
                } else {
                    console.error("A stored file couldn't be read", {
                        key,
                        error
                    })
                    throw error
                }
            }
        },

        async open(key, range) {
            const path = pathOf(key)
            const found = await stat(path).catch((error: unknown) => {
                if (
                    error instanceof Error &&
                    "code" in error &&
                    error.code === "ENOENT"
                ) {
                    return null
                } else {
                    console.error("A stored file couldn't be opened", {
                        key,
                        error
                    })
                    throw error
                }
            })
            if (found === null) {
                return { ok: false, error: "not-found" }
            }
            const size = found.size
            const start = range?.start ?? 0
            const end = Math.min(range?.end ?? size - 1, size - 1)
            if (start >= size && size > 0) {
                return { ok: false, error: "unsatisfiable" }
            } else {
                return {
                    ok: true,
                    data: {
                        // An empty file is an empty body: a read stream
                        // can't end before it starts
                        body:
                            size === 0
                                ? new ReadableStream<Uint8Array>({
                                      start: (controller) => controller.close()
                                  })
                                : streamOf(path, start, end),
                        size,
                        start,
                        end,
                        partial: range !== undefined
                    }
                }
            }
        },

        async delete(key) {
            await rm(pathOf(key), { force: true })
        },

        async list(prefix, options) {
            // Only the folder the prefix ends in is walked, as far down as it
            // goes, and a folder not made yet holds nothing
            const slash = prefix.lastIndexOf("/")
            const start =
                slash === -1 ? directory : pathOf(prefix.slice(0, slash))
            const found = await readdir(start, {
                recursive: true,
                withFileTypes: true
            }).catch((error: unknown) => {
                if (missing(error)) {
                    return []
                } else {
                    throw error
                }
            })
            const files: ListedFile[] = []
            for (const entry of found) {
                // Leaving out what the system adds, like macOS's .DS_Store
                if (entry.isFile() && !entry.name.startsWith(".")) {
                    const path = join(entry.parentPath, entry.name)
                    const details = await stat(path)
                    files.push({
                        key: relative(directory, path).split(sep).join("/"),
                        size: details.size,
                        modified: details.mtime
                    })
                }
            }
            return pageOf(files, prefix, options)
        },

        async head(key) {
            const details = await stat(pathOf(key)).catch((error: unknown) => {
                if (missing(error)) {
                    return null
                } else {
                    throw error
                }
            })
            if (details === null || !details.isFile()) {
                return null
            } else {
                return {
                    size: details.size,
                    content_type: contentTypeOf(key),
                    modified: details.mtime
                }
            }
        },

        async presignGet() {
            return { ok: false, error: "not-presignable" }
        },

        async presignPost() {
            return { ok: false, error: "not-presignable" }
        }
    }
}

// Whether `error` is the file system saying there's nothing there
function missing(error: unknown) {
    return error instanceof Error && "code" in error && error.code === "ENOENT"
}

// A file's content type, guessed from its name, since the folder keeps only
// the bytes: the types a screen shows something for, and bytes otherwise
const CONTENT_TYPES: Record<string, string> = {
    csv: "text/csv",
    gif: "image/gif",
    html: "text/html; charset=utf-8",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    json: "application/json",
    md: "text/markdown; charset=utf-8",
    mov: "video/quicktime",
    mp3: "audio/mpeg",
    mp4: "video/mp4",
    pdf: "application/pdf",
    png: "image/png",
    svg: "image/svg+xml",
    txt: "text/plain; charset=utf-8",
    webm: "video/webm",
    webp: "image/webp"
}

function contentTypeOf(key: string) {
    const extension = key.split(".").at(-1)?.toLowerCase() ?? ""
    return CONTENT_TYPES[extension] ?? "application/octet-stream"
}

// A file's bytes from `start` to `end` inclusive, as a web stream, read a
// chunk at a time as the reader asks for more
function streamOf(path: string, start: number, end: number) {
    const file = createReadStream(path, { start, end })
    const chunks = file[Symbol.asyncIterator]()
    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            const next = await chunks.next()
            if (next.done === true) {
                controller.close()
            } else {
                controller.enqueue(new Uint8Array(next.value))
            }
        },
        cancel() {
            file.destroy()
        }
    })
}
