import { useMutation } from "@tanstack/react-query"
import { useEffect, useId, useRef, useState } from "react"
import { Button } from "@/frontend/components/primitives/button"
import { ButtonKeys } from "@/frontend/components/primitives/kbd"
import { Textarea } from "@/frontend/components/primitives/textarea"
import { fileComment } from "@/frontend/queries/comments"
import { failureOf } from "@/frontend/queries/failures"
import { pagePath } from "@/frontend/visitors/describe"
import type { CommentedElement } from "@/utilities/schemas/comments"
import { comment_body } from "@/utilities/schemas/comments"
import { elementName } from "./describe"
import { useRect } from "./picker"

// The box a comment is written in, beside the element it's on: Save sends
// it through the app's own /api/comments to Infra. What's written stays
// while another element is picked, and after a save that failed.

// How wide the box is, and how far it keeps from the element and the
// window's edges, in CSS pixels
const WIDTH = 320
const GAP = 8
const MARGIN = 16
// Room kept for the toolbar itself, at the window's top or bottom
const TOOLBAR_ROOM = 72

/**
 * The comment box for `element`, described as `described`. `draft` is
 * what's written, kept by the toolbar so picking another element keeps
 * it. `toolbar_at_top` says which edge the toolbar is pinned to, which
 * the box keeps clear of. Calls `onFiled` once Infra has kept it, and
 * `onCancel` to put it away.
 */
export function Composer({
    element,
    described,
    draft,
    toolbar_at_top,
    onDraftChange,
    onFiled,
    onCancel
}: {
    element: Element
    described: CommentedElement
    draft: string
    toolbar_at_top: boolean
    onDraftChange: (draft: string) => void
    onFiled: () => void
    onCancel: () => void
}) {
    const rect = useRect(element)
    const box = useRef<HTMLFormElement>(null)
    const field = useRef<HTMLTextAreaElement>(null)
    const [height, setHeight] = useState(180)
    const [problem, setProblem] = useState<string | null>(null)
    const label = useId()
    const filing = useMutation({
        ...fileComment,
        onSuccess: onFiled,
        onError: (error) => setProblem(failureMessage(error))
    })

    // The field takes the keyboard as the box opens, which it does again
    // for each element picked (the toolbar keys it by the pick)
    useEffect(() => {
        field.current?.focus()
    }, [])

    // Its real height, which places it above the element when there's no
    // room below
    useEffect(() => {
        const observed = box.current
        if (observed === null) {
            return
        }
        const observer = new ResizeObserver(() =>
            setHeight(observed.offsetHeight)
        )
        observer.observe(observed)
        return () => observer.disconnect()
    }, [])

    function save() {
        const checked = comment_body.safeParse(draft)
        if (!checked.success) {
            setProblem(checked.error.issues[0]?.message ?? "Write something")
            field.current?.focus()
            return
        }
        setProblem(null)
        filing.mutate({
            body: checked.data,
            path: pagePath(window.location.pathname),
            title: document.title.trim().slice(0, 200) || null,
            element: described,
            viewport: { width: window.innerWidth, height: window.innerHeight }
        })
    }

    const position = placed(rect, height, toolbar_at_top)
    return (
        <form
            ref={box}
            data-toolbar
            data-untracked
            aria-labelledby={label}
            onSubmit={(event) => {
                event.preventDefault()
                save()
            }}
            className="fixed z-[2147483646] flex flex-col gap-2 rounded-xl border bg-popover p-3 text-popover-foreground shadow-[0_8px_24px_-6px_rgb(0_0_0/0.25)]"
            style={{
                top: position.top,
                left: position.left,
                width: `min(${WIDTH}px, calc(100vw - ${2 * MARGIN}px))`
            }}
        >
            <p id={label} className="truncate text-xs text-muted-foreground">
                Comment on{" "}
                <span className="font-medium text-foreground">
                    {elementName(described)}
                </span>
            </p>
            <Textarea
                ref={field}
                value={draft}
                onChange={(event) => onDraftChange(event.target.value)}
                onKeyDown={(event) => {
                    if (
                        event.key === "Enter" &&
                        (event.metaKey || event.ctrlKey)
                    ) {
                        event.preventDefault()
                        save()
                    }
                }}
                placeholder="What should change here?"
                aria-invalid={problem !== null}
                aria-describedby={
                    problem === null ? undefined : `${label}-problem`
                }
                disabled={filing.isPending}
                rows={3}
                className="max-h-48 min-h-20 resize-none"
            />
            {problem !== null && (
                <p
                    id={`${label}-problem`}
                    role="alert"
                    className="text-xs text-destructive"
                >
                    {problem}
                </p>
            )}
            <div className="flex items-center justify-end gap-2">
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onCancel}
                    disabled={filing.isPending}
                >
                    Cancel
                </Button>
                <Button
                    type="submit"
                    size="sm"
                    disabled={filing.isPending}
                    className="gap-2"
                >
                    {filing.isPending ? "Saving…" : "Save"}
                    <ButtonKeys keys={[modifierKey(), "↵"]} />
                </Button>
            </div>
        </form>
    )
}

// Where the box goes: below the element when there's room, else above it,
// else as low as the window allows; always within the window, clear of the
// toolbar
function placed(
    rect: { top: number; left: number; height: number } | null,
    height: number,
    toolbar_at_top: boolean
) {
    const window_width = window.innerWidth
    const window_height = window.innerHeight
    const width = Math.min(WIDTH, window_width - 2 * MARGIN)
    const highest = toolbar_at_top ? TOOLBAR_ROOM : MARGIN
    const lowest =
        window_height - (toolbar_at_top ? MARGIN : TOOLBAR_ROOM) - height
    if (rect === null) {
        return {
            top: Math.max(highest, lowest),
            left: (window_width - width) / 2
        }
    }
    const below = rect.top + rect.height + GAP
    const above = rect.top - GAP - height
    const top =
        below <= lowest
            ? below
            : above >= highest
              ? above
              : Math.max(highest, Math.min(lowest, below))
    const left = Math.min(
        Math.max(MARGIN, rect.left),
        window_width - width - MARGIN
    )
    return { top, left }
}

// ⌘ on a Mac, Ctrl elsewhere
function modifierKey() {
    return /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl"
}

// What to say when a save failed, by what the server answered
function failureMessage(error: Error) {
    const failure = failureOf(error)
    if (failure.reason === "logged-out") {
        return "You've been logged out. Log in again to comment."
    } else if (failure.reason === "invalid") {
        return "That comment can't be sent as it is."
    } else {
        return "Couldn't save the comment. Try again in a moment."
    }
}
