import { Link } from "@tanstack/react-router"
import { useId, useState } from "react"
import { Input } from "@/frontend/components/primitives/input"
import { Label } from "@/frontend/components/primitives/label"
import { useSession } from "@/frontend/queries/auth"
import type { Area } from "@/utilities/permissions"
import { ADMIN_NAVIGATION } from "./navigation"
import { PromptChip } from "./prompt"
import { settingsShownTo } from "./settings/screen"
import { sectionHeading } from "./shell"

// The admin's Overview, where /admin opens: its home, which says the
// dashboard is the business's to build, and how. It comes with the team,
// in Settings, and everyone's own account; every other section is the
// business's own, which Claude Code builds when it's asked, a prompt each
// (./prompt.tsx). A business makes this page its own too, with what its
// team wants to see first.

/** Something the app already has, which a section would show. */
type Suggestion = {
    name: string
    what: string
    prompt: string
    // The area a section built for it shows: once one in the sidebar does,
    // it's built, and the suggestion goes
    area?: Area
}

const SUGGESTIONS: readonly Suggestion[] = [
    {
        name: "Files",
        what: "The team's files already have routes in the API: folders, uploads straight to the bucket, links to send and a Trash. A section gives them a screen.",
        prompt: "Add a Files section to the admin, on the routes in source/backend/files/",
        area: "files"
    },
    {
        name: "Workflows",
        what: "The background work already runs in the server, and keeps every run in the database. A section shows each run as it goes, its steps, and what went wrong where one failed.",
        prompt: "Add a Workflows section to the admin that shows the runs from /api/workflows as they run, with a way to run a failed one again",
        area: "workflows"
    },
    {
        name: "This week's visits",
        what: "Every page of the site already counts its visits, in the app's own database. This page could show how many came this week, and from where.",
        prompt: "Show this week's visits on the admin's Overview: how many, and where they came from"
    }
]

// Whether a section in the sidebar already shows this area
function built(area: Area) {
    return ADMIN_NAVIGATION.some(({ sections }) =>
        sections.some((section) => section.area === area)
    )
}

/** The Overview: what the dashboard is, and how it grows. */
export function OverviewScreen() {
    const session = useSession()
    if (session.status !== "logged-in") {
        // routes/admin/route.tsx draws the way in until someone is
        return null
    }
    const suggestions = SUGGESTIONS.filter(
        (suggestion) => suggestion.area === undefined || !built(suggestion.area)
    )
    const settings = settingsShownTo(session.permissions).length > 0

    return (
        <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto flex max-w-3xl flex-col gap-12 px-4 py-6 sm:px-8 sm:py-10">
                <header className="flex flex-col gap-2">
                    <h1 className="text-balance font-heading font-semibold text-2xl tracking-tight">
                        Overview
                    </h1>
                    <p className="max-w-prose text-pretty text-muted-foreground">
                        Your business's own dashboard, for the team listed in
                        the app's code. It comes with the team and your account,
                        and the rest is yours to build.
                    </p>
                </header>

                <section
                    aria-labelledby="build-heading"
                    className="flex flex-col gap-5"
                >
                    <div className="flex flex-col gap-2">
                        <h2 id="build-heading" className={sectionHeading}>
                            Build your dashboard
                        </h2>
                        <p className="max-w-prose text-pretty text-muted-foreground text-sm leading-relaxed">
                            Each section is a screen here, with routes in the
                            API under it and a table in the database for what it
                            keeps. Ask Claude Code for one: it builds all three
                            and adds the section to the sidebar, in a pull
                            request you merge.
                        </p>
                    </div>
                    <NewSection />
                </section>

                {suggestions.length > 0 && (
                    <section
                        aria-labelledby="already-heading"
                        className="flex flex-col gap-3"
                    >
                        <h2 id="already-heading" className={sectionHeading}>
                            Start from what the app already has
                        </h2>
                        <ul className="flex flex-col divide-y border-y">
                            {suggestions.map((suggestion) => (
                                <li
                                    key={suggestion.name}
                                    className="flex flex-col gap-2.5 py-4"
                                >
                                    <div className="flex flex-col gap-1">
                                        <h3 className="font-medium text-sm">
                                            {suggestion.name}
                                        </h3>
                                        <p className="max-w-prose text-pretty text-muted-foreground text-sm">
                                            {suggestion.what}
                                        </p>
                                    </div>
                                    <PromptChip prompt={suggestion.prompt} />
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

                <p className="max-w-prose text-pretty text-muted-foreground text-sm">
                    {settings && (
                        <>
                            The team is in{" "}
                            <Link
                                to="/admin/settings"
                                className="text-foreground underline decoration-foreground/40 underline-offset-4 hover:decoration-foreground"
                            >
                                Settings
                            </Link>
                            , the gear beside your name.{" "}
                        </>
                    )}
                    Your name opens{" "}
                    <Link
                        to="/admin/account"
                        className="text-foreground underline decoration-foreground/40 underline-offset-4 hover:decoration-foreground"
                    >
                        your account
                    </Link>
                    : the browsers you're logged in on, where you've let Claude
                    in to work here as you, and your API tokens.
                </p>
            </div>
        </div>
    )
}

// A section of the business's own, from what it keeps track of: the
// prompt that has Claude Code build it, which copies itself
function NewSection() {
    const id = useId()
    const [keeps, setKeeps] = useState("")
    const typed = keeps.trim() || "customers"
    // "Bookings" reads as "bookings" in the sentence; "SEO audits" stays
    const word = /^[A-Z][a-z]/.test(typed)
        ? `${typed.slice(0, 1).toLowerCase()}${typed.slice(1)}`
        : typed
    const prompt = `Add a section to the admin for our ${word}: a list of them, with each one's details, kept in the app's database`

    return (
        <div className="flex flex-col gap-4 rounded-xl border bg-card p-4 sm:p-5">
            <div className="flex flex-col gap-2">
                <Label htmlFor={id}>What should it keep track of?</Label>
                <Input
                    id={id}
                    value={keeps}
                    onChange={(event) => setKeeps(event.target.value)}
                    placeholder="customers"
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={60}
                    className="h-10 sm:max-w-xs"
                />
            </div>
            <div className="flex flex-col gap-2">
                <p className="text-muted-foreground text-sm">
                    Then give this to Claude Code:
                </p>
                <PromptChip prompt={prompt} />
            </div>
        </div>
    )
}
