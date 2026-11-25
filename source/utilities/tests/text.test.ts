import { expect, test } from "vitest"
import { event_properties, page_path } from "@/utilities/schemas/events"
import { item_name } from "@/utilities/schemas/files"
import { isStorable } from "@/utilities/schemas/text"

// What the database can keep of a string, checked where it comes in

test("a whole emoji is kept, and half of one or a U+0000 is refused", () => {
    expect(isStorable("Café 😀")).toBe(true)
    expect(isStorable("😀".slice(0, 1))).toBe(false)
    expect(isStorable("😀".slice(1))).toBe(false)
    expect(isStorable("a\u0000b")).toBe(false)
})

test("an event, a page's path and a file's name refuse what the database can't keep", () => {
    expect(
        event_properties.safeParse({ text: `cut ${"😀".slice(0, 1)}` }).success
    ).toBe(false)
    expect(event_properties.safeParse({ "a\u0000": 1 }).success).toBe(false)
    expect(event_properties.safeParse({ text: "fine 😀" }).success).toBe(true)
    expect(page_path.safeParse("/a\u0000").success).toBe(false)
    expect(item_name.safeParse("Notes\u0000.txt").success).toBe(false)
})
