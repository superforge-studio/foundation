import { cn } from "cn"
import { Check, Copy } from "lucide-react"
import { type ReactNode, useState } from "react"
import { Button } from "@/frontend/components/primitives/button"
import { textButton } from "./shell"

// A change only the app's code can make, like a section of the dashboard
// or someone on the team, handed to Claude Code as a prompt: the owner
// copies it, Claude Code makes the change and opens a pull request, and
// merging it puts the change live (workbench/commit-and-deploy.md).

// Copying a prompt, and whether it copied: null until it's tried, and
// again once the prompt has changed since
function useCopied(prompt: string) {
    const [copied, setCopied] = useState<{
        prompt: string
        done: boolean
    } | null>(null)
    const said = copied?.prompt === prompt ? copied.done : null

    async function copy() {
        const done = await navigator.clipboard
            .writeText(prompt)
            .then(() => true)
            .catch((error: unknown) => {
                console.info("A prompt didn't copy", { error })
                return false
            })
        setCopied({ prompt, done })
    }

    return { said, copy }
}

/**
 * A button that copies `prompt` for Claude Code, and says whether it did:
 * the main action of a form that writes one (`look` `button`), or a text
 * button beside something that changes in the code (`text`).
 */
export function CopyPrompt({
    prompt,
    label = "Copy for Claude Code",
    look = "button"
}: {
    prompt: string
    label?: string
    look?: "button" | "text"
}) {
    const { said, copy } = useCopied(prompt)
    return (
        <span className="flex flex-wrap items-center gap-3">
            {look === "button" ? (
                <Button size="sm" onClick={copy}>
                    <Copy aria-hidden />
                    {label}
                </Button>
            ) : (
                <button
                    type="button"
                    className={cn(
                        textButton,
                        "inline-flex items-center gap-1.5"
                    )}
                    onClick={copy}
                >
                    <Copy aria-hidden className="size-3.5" />
                    {label}
                </button>
            )}
            <span role="status" className="text-sm empty:hidden">
                {said === true && (
                    <span className="flex items-center gap-1.5">
                        <Check aria-hidden className="size-4 text-success" />
                        Copied
                    </span>
                )}
                {said === false && look === "button" && (
                    <span className="text-muted-foreground">
                        It didn't copy: select the text and copy it yourself.
                    </span>
                )}
            </span>
            {said === false && look === "text" && <SelectIt prompt={prompt} />}
        </span>
    )
}

/**
 * Something to say to Claude Code, which copies itself when it's clicked:
 * the words in quotes, as the prompt to start a change with.
 */
export function PromptChip({
    prompt,
    className
}: {
    prompt: string
    className?: string
}) {
    const { said, copy } = useCopied(prompt)
    return (
        <span className={cn("flex flex-col gap-2", className)}>
            <button
                type="button"
                onClick={copy}
                className="group/chip inline-flex w-fit max-w-full items-start gap-2 rounded-lg border bg-background px-3 py-1.5 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
            >
                <span className="min-w-0 text-pretty">“{prompt}”</span>
                <span className="flex h-5 shrink-0 items-center gap-1 text-muted-foreground text-xs group-hover/chip:text-foreground">
                    {said === true ? (
                        <Check aria-hidden className="size-3.5 text-success" />
                    ) : (
                        <Copy aria-hidden className="size-3.5" />
                    )}
                    <span
                        role="status"
                        className={cn(said !== true && "sr-only")}
                    >
                        {said === true ? "Copied" : "Copy"}
                    </span>
                </span>
            </button>
            {said === false && <SelectIt prompt={prompt} />}
        </span>
    )
}

// A prompt that didn't copy, to select and copy by hand
function SelectIt({ prompt }: { prompt: string }) {
    return (
        <span className="flex w-full flex-col gap-1.5">
            <span className="text-muted-foreground text-sm">
                It didn't copy: select this and copy it yourself.
            </span>
            <pre className="whitespace-pre-wrap rounded-lg border bg-muted px-3 py-2.5 text-foreground text-sm">
                {prompt}
            </pre>
        </span>
    )
}

/** One numbered step of handing a change to Claude Code, in an `<ol>`. */
export function Step({
    number,
    children
}: {
    number: number
    children: ReactNode
}) {
    return (
        <li className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-3">
            <span
                aria-hidden
                className="flex size-6 items-center justify-center rounded-full border font-medium text-muted-foreground text-xs"
            >
                {number}
            </span>
            <div className="flex min-w-0 flex-col gap-2.5">{children}</div>
        </li>
    )
}
