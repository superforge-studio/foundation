import { z } from "zod"

// What Postgres can keep of a string: never U+0000, which `text` and
// `jsonb` both refuse, and never half of a pair of UTF-16 units, like the
// first half of an emoji cut in two, which `jsonb` refuses. A string headed
// for the database is checked with `storable`, so it's refused as a 400
// the sender drops, rather than failing the insert as a 500 the sender
// tries again.

// A lone surrogate: a high one with no low one after it, or a low one with
// no high one before it
const LONE_SURROGATE =
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

/** Whether Postgres can keep `text` as it is. */
export function isStorable(text: string) {
    return !text.includes("\u0000") && !LONE_SURROGATE.test(text)
}

/** `schema`, refusing a string Postgres can't keep. */
export function storable<Schema extends z.ZodType<string>>(schema: Schema) {
    return schema.refine(isStorable, "Text the database can't keep")
}

/** Any string Postgres can keep. */
export const storable_string = storable(z.string())
