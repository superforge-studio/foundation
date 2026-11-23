import { cn } from "cn"
import {
    CheckIcon,
    GripVerticalIcon,
    InfoIcon,
    MessageSquarePlusIcon
} from "lucide-react"
import {
    useCallback,
    useEffect,
    useRef,
    useState,
    useSyncExternalStore
} from "react"
import { Keys } from "@/frontend/components/primitives/kbd"
import {
    Popover,
    PopoverContent,
    PopoverDescription,
    PopoverTitle,
    PopoverTrigger
} from "@/frontend/components/primitives/popover"
import { useSession } from "@/frontend/queries/auth"
import type { CommentedElement } from "@/utilities/schemas/comments"
import { Composer } from "./composer"
import { describeElement } from "./describe"
import { elementFacts } from "./element"
import { Outline, usePicker } from "./picker"
import { PIN_NAMES } from "./pins"
import { usePlacement } from "./placement"

// The toolbar on every page for the business's own people, listed in code
// (backend/auth/access.ts), on a computer with a mouse: Comment picks an element, and what's written about it goes to
// Superforge Infra through the app's own /api/comments, for Claude to fix
// later. Its handle moves it to the middle of the bottom or a corner.
// README.md here has what a comment carries and what it never does.

/** What the toolbar is doing. */
type Mode =
    | { kind: "idle" }
    // Waiting for a click on the element a comment is on
    | { kind: "picking" }
    // Writing about the element picked, which another click changes: the
    // `pick`th since the page loaded
    | {
          kind: "writing"
          element: Element
          described: CommentedElement
          pick: number
      }

/** How long "Saved" shows after a comment is kept, in milliseconds. */
const SAVED_FOR = 2500

/**
 * The toolbar, for the team, drawn by the root route on every page, on a
 * computer with a mouse: picking an element by touch is fiddly, and on a
 * phone the toolbar covers too much. Nothing for a visitor, nor in the
 * prerender, which draws every page for a visitor.
 */
export function Toolbar() {
    const session = useSession()
    const mouse = useMouse()
    if (session.status === "logged-in" && mouse) {
        return <LoggedInToolbar />
    } else {
        return null
    }
}

// A pointer that can hover and point precisely, as a mouse or a trackpad
// can and a finger can't
const MOUSE = "(hover: hover) and (pointer: fine)"

// Whether this device has one, kept current as one's plugged in or the
// window moves to another screen; never in the prerender
function useMouse() {
    return useSyncExternalStore(
        (changed) => {
            const query = window.matchMedia(MOUSE)
            query.addEventListener("change", changed)
            return () => query.removeEventListener("change", changed)
        },
        () => window.matchMedia(MOUSE).matches,
        () => false
    )
}

function LoggedInToolbar() {
    const [mode, setMode] = useState<Mode>({ kind: "idle" })
    const [draft, setDraft] = useState("")
    const [saved, setSaved] = useState(false)
    // Whether the ⓘ's note on what the toolbar is for is open
    const [about, setAbout] = useState(false)
    const pill = useRef<HTMLDivElement>(null)
    const comment_button = useRef<HTMLButtonElement>(null)
    const picks = useRef(0)
    const placement = usePlacement(pill)

    const stop = useCallback(() => {
        setMode({ kind: "idle" })
        comment_button.current?.focus()
    }, [])
    const start = useCallback(() => {
        setSaved(false)
        setAbout(false)
        setMode({ kind: "picking" })
    }, [])

    const hovered = usePicker({
        active: mode.kind !== "idle",
        onPick: (element) => {
            picks.current += 1
            setMode({
                kind: "writing",
                element,
                described: describeElement(elementFacts(element)),
                pick: picks.current
            })
        },
        // Out of writing back to picking, and out of picking altogether
        onEscape: () => {
            if (mode.kind === "writing") {
                setMode({ kind: "picking" })
            } else {
                stop()
            }
        }
    })

    // "Saved" shows a moment, then the toolbar's as it was
    useEffect(() => {
        if (!saved) {
            return
        }
        const timer = setTimeout(() => setSaved(false), SAVED_FOR)
        return () => clearTimeout(timer)
    }, [saved])

    const active = mode.kind !== "idle"
    const at_top = placement.pin.startsWith("top")
    return (
        <>
            {mode.kind !== "idle" && hovered !== null && (
                <Outline
                    element={
                        mode.kind === "writing" && hovered === mode.element
                            ? null
                            : hovered
                    }
                />
            )}
            {mode.kind === "writing" && (
                <>
                    <Outline element={mode.element} picked />
                    <Composer
                        key={mode.pick}
                        element={mode.element}
                        described={mode.described}
                        draft={draft}
                        toolbar_at_top={at_top}
                        onDraftChange={setDraft}
                        onFiled={() => {
                            setDraft("")
                            setSaved(true)
                            stop()
                        }}
                        onCancel={() => setMode({ kind: "picking" })}
                    />
                </>
            )}
            <div
                ref={pill}
                role="toolbar"
                aria-label="Superforge toolbar"
                data-toolbar
                data-untracked
                className={cn(
                    "fixed z-[2147483647] flex items-center gap-0.5 rounded-full bg-foreground p-1 text-background shadow-[0_6px_20px_-4px_rgb(0_0_0/0.35)]",
                    placement.place,
                    placement.dragging &&
                        "shadow-[0_12px_32px_-6px_rgb(0_0_0/0.45)]"
                )}
                style={{ transform: placement.transform }}
            >
                <button
                    type="button"
                    aria-label={`Move the toolbar, now at the ${PIN_NAMES[placement.pin]}: drag it, or use the arrow keys`}
                    {...placement.handle}
                    className={cn(
                        PILL_BUTTON,
                        "min-w-6 w-6 touch-none text-background/55 hover:bg-transparent hover:text-background",
                        placement.dragging
                            ? "cursor-grabbing text-background"
                            : "cursor-grab"
                    )}
                >
                    <GripVerticalIcon className="size-4" />
                </button>
                <button
                    ref={comment_button}
                    type="button"
                    aria-pressed={active}
                    aria-keyshortcuts={active ? "Escape" : undefined}
                    onClick={active ? stop : start}
                    className={cn(
                        PILL_BUTTON,
                        "gap-2 px-3",
                        active &&
                            "bg-background text-foreground hover:bg-background/90"
                    )}
                >
                    {saved ? (
                        <CheckIcon className="size-4" />
                    ) : (
                        <MessageSquarePlusIcon className="size-4" />
                    )}
                    <span aria-live="polite">
                        {saved
                            ? "Saved"
                            : active
                              ? "Pick an element"
                              : "Comment"}
                    </span>
                    {active && (
                        <Keys
                            keys={["Esc"]}
                            className="[&_kbd]:bg-foreground/10 [&_kbd]:text-foreground/70"
                        />
                    )}
                </button>
                <Popover open={about} onOpenChange={setAbout}>
                    <PopoverTrigger
                        aria-label="What this toolbar is for"
                        className={cn(PILL_BUTTON, about && "bg-background/15")}
                    >
                        <InfoIcon className="size-4" />
                    </PopoverTrigger>
                    <PopoverContent
                        side={at_top ? "bottom" : "top"}
                        sideOffset={10}
                        data-toolbar
                        data-untracked
                        className="w-80 gap-2 p-3.5 text-pretty leading-relaxed"
                    >
                        <PopoverTitle>
                            Spot it, file it, keep working
                        </PopoverTitle>
                        <PopoverDescription>
                            See something that should change? Click Comment,
                            pick it on the page and say what you'd change. Then
                            get back to what you were doing.
                        </PopoverDescription>
                        <PopoverDescription>
                            The AI that builds this app works through everything
                            filed: the next time someone asks it to, or on a
                            schedule if one's set up.
                        </PopoverDescription>
                        <PopoverDescription>
                            Software you buy changes when its vendor gets to it.
                            This app is yours, so you and your team are its
                            quality control, and it gets better with every
                            comment.
                        </PopoverDescription>
                    </PopoverContent>
                </Popover>
            </div>
        </>
    )
}

// A button on the toolbar's pill, round, as tall as its row
const PILL_BUTTON =
    "inline-flex h-8 min-w-8 shrink-0 items-center whitespace-nowrap justify-center rounded-full text-sm font-medium outline-none transition-colors hover:bg-background/15 focus-visible:ring-2 focus-visible:ring-background/60"
