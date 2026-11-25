import { createFileRoute } from "@tanstack/react-router"
import { ArrowUpRight } from "lucide-react"
import { EnvironmentChip } from "@/frontend/components/welcome/environment"
import { LineMap } from "@/frontend/components/welcome/line-map"
import { NextStops } from "@/frontend/components/welcome/next-stops"
import { PromptChip } from "@/frontend/components/welcome/prompt-chip"

export const Route = createFileRoute("/")({
    component: Home
})

// The template's own home page: in a dev server, the app as a line, with
// the health check running it, and what to do next; in a build, only that
// the site is running, so a copy deployed before it has a home page of its
// own tells no visitor how it's built. START-HERE.md's step 3 replaces this
// page with the business's own, and deletes components/welcome/ with it.

// Where the docs are, for the footer
const DOCS = [
    { path: "README.md", what: "what's in it, and how to run it" },
    { path: "CLAUDE.md", what: "what Claude reads before every change" },
    { path: "workbench/", what: "writing code, designing, shipping, updating" },
    { path: "CHANGELOG.md", what: "Foundation's releases, newest first" }
] as const

function Home() {
    return import.meta.env.DEV ? <LineHome /> : <Running />
}

// What a build shows, until the business's own home page replaces it
function Running() {
    return (
        <main className="mx-auto flex min-h-svh max-w-2xl flex-col justify-center gap-3 px-5 py-10 sm:px-8">
            <h1 className="text-balance font-heading font-semibold text-3xl tracking-tight">
                This site is running.
            </h1>
            <p className="text-pretty text-muted-foreground leading-relaxed">
                Its home page is on its way.
            </p>
        </main>
    )
}

function LineHome() {
    return (
        <main className="mx-auto flex max-w-5xl flex-col gap-12 px-5 py-6 sm:px-8 sm:py-10">
            <header className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-2.5">
                    {/* The favicon, which follows the device's theme itself */}
                    <img src="/favicon.svg" alt="" className="size-5" />
                    <span className="font-medium text-sm">Your business</span>
                </span>
                <EnvironmentChip />
            </header>

            <section className="flex max-w-2xl flex-col gap-3">
                <h1 className="text-balance font-heading font-semibold text-3xl tracking-tight sm:text-4xl">
                    One codebase, from the page to the database.
                </h1>
                <p className="max-w-[58ch] text-pretty text-muted-foreground leading-relaxed">
                    When this page opened, it asked your API whether the
                    database was up. This is the line that question ran along,
                    and every part it passes on the way.
                </p>
                {/* Beside the line on a wide screen, the next stops say this */}
                <p className="mt-2 flex flex-wrap items-center gap-2 text-sm lg:hidden">
                    New here? Say
                    <PromptChip prompt="start here" />
                    to Claude.
                </p>
            </section>

            <div className="grid gap-x-16 gap-y-12 lg:grid-cols-[minmax(0,1fr)_19rem]">
                <LineMap />
                <NextStops className="lg:sticky lg:top-10 lg:self-start" />
            </div>

            <footer className="flex flex-col gap-4 border-t pt-6 text-muted-foreground text-sm sm:flex-row sm:items-start sm:justify-between">
                <ul className="flex flex-col gap-1.5">
                    {DOCS.map((doc) => (
                        <li key={doc.path}>
                            <code className="font-mono text-foreground text-xs">
                                {doc.path}
                            </code>{" "}
                            <span>{doc.what}</span>
                        </li>
                    ))}
                </ul>
                <a
                    href="https://github.com/superforge-studio/starter-template"
                    className="inline-flex shrink-0 items-center gap-1 underline-offset-4 hover:text-foreground hover:underline"
                >
                    Superforge Foundation
                    <ArrowUpRight aria-hidden className="size-3.5" />
                </a>
            </footer>
        </main>
    )
}
