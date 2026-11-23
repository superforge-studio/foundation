import type { Context } from "hono"
import type {
    ByteRange,
    Opened,
    OpenFailure,
    PresignFailure,
    PresignGetOptions
} from "@/database/storage"
import { attachment } from "@/database/storage/bucket"
import { MINUTE } from "@/utilities/primitives/durations"
import { failure } from "../failures"

// Handing a file to a browser: straight from the bucket on a link that
// works for five minutes, so the server never holds it and the bucket's
// egress is free, or, in a dev server, whose folder can't sign a link,
// streamed by the server itself, a range at a time.

/** How long a download's or a preview's link works. */
const DOWNLOAD_LINK_SECONDS = (5 * MINUTE) / 1000

// What a browser shows in place without running anything in it, at the
// app's own address in a dev server: everything else downloads there, and
// can't run if it's opened, so an uploaded page or SVG never runs as the
// app. From the bucket, a file is on the bucket's own address anyway.
const SHOWN_IN_PLACE =
    /^(image\/(png|jpeg|gif|webp|avif)|video\/|audio\/|application\/pdf|text\/plain|text\/csv)(;|$)/

/** A file to send, however it's found, with its name and type. */
export type SendableFile = {
    name: string
    content_type: string
    presignGet(
        options: PresignGetOptions
    ): AsyncOperationResult<string, PresignFailure>
    open(range?: ByteRange): AsyncOperationResult<Opened, OpenFailure>
}

/**
 * Answers with `file`: a redirect to the bucket, or the file itself from a
 * dev server. `inline` shows it in place, for a preview; otherwise it
 * downloads under its name.
 */
export async function sendFile(
    context: Context,
    file: SendableFile,
    inline: boolean
) {
    const link = await file.presignGet({
        seconds: DOWNLOAD_LINK_SECONDS,
        download: inline ? undefined : file.name
    })
    if (link.ok) {
        return context.redirect(link.data, 302)
    }

    // A dev server's folder: the file itself, a range at a time
    const range = requestedRange(context.req.header("range"))
    if (range === "unsatisfiable") {
        return context.body(null, 416, { "Accept-Ranges": "bytes" })
    }
    const opened = await file.open(range)
    if (!opened.ok && opened.error === "unsatisfiable") {
        return context.body(null, 416, { "Accept-Ranges": "bytes" })
    } else if (!opened.ok) {
        console.error("A file's row is here but its bytes aren't", {
            name: file.name
        })
        return failure(
            context,
            404,
            "no-bytes",
            "This file's bytes are missing"
        )
    }
    const { body, size, start, end, partial } = opened.data
    const in_place = inline && SHOWN_IN_PLACE.test(file.content_type)
    const headers: Record<string, string> = {
        "Content-Type": file.content_type,
        "Content-Length": String(end - start + 1),
        "Accept-Ranges": "bytes",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": in_place
            ? attachment(file.name).replace(/^attachment/, "inline")
            : attachment(file.name)
    }
    if (!in_place) {
        headers["Content-Security-Policy"] = "sandbox; default-src 'none'"
    }
    if (partial) {
        headers["Content-Range"] = `bytes ${start}-${end}/${size}`
        return context.body(body, 206, headers)
    } else {
        return context.body(body, 200, headers)
    }
}

/**
 * The bytes a Range header asks for: `bytes=0-1023`, or `bytes=1024-` to
 * the end. Anything else, like several ranges or the last bytes alone
 * (`bytes=-500`), is answered whole, which HTTP allows.
 */
export function requestedRange(
    header: string | undefined
): ByteRange | "unsatisfiable" | undefined {
    const found = header?.trim().match(/^bytes=(\d+)-(\d*)$/)
    if (found === undefined || found === null) {
        return undefined
    }
    const start = Number(found[1])
    if (found[2] === "") {
        return { start }
    }
    const end = Number(found[2])
    if (end < start) {
        return "unsatisfiable"
    } else {
        return { start, end }
    }
}
