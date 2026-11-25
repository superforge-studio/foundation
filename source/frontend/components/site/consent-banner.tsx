import { useSyncExternalStore } from "react"
import { Button } from "@/frontend/components/primitives/button"
import {
    answerConsent,
    askingConsent,
    onAskingChange
} from "@/frontend/visitors"

/**
 * Asks a visitor whether the site may remember their browser between
 * visits (frontend/visitors/). A small note in a corner rather than a
 * modal, so the page works the same whether they answer or not, and until
 * they accept, the site sets no lasting cookie on them. Both answers are
 * the same size, and the server keeps either in a cookie, so they aren't
 * asked again. It shows only in a browser, when the server's latest answer
 * to the page's events said to ask: by `visitor_mode` (utilities/settings/),
 * and where the visitor is, for a visitor who hasn't answered. Never in
 * the prerender, where it's always hidden. The root route draws it on
 * every page, the dashboard's too.
 */
export function ConsentBanner() {
    const asking = useSyncExternalStore(
        onAskingChange,
        askingConsent,
        () => false
    )
    if (!asking) {
        return null
    } else {
        return (
            <section
                aria-label="Remembering this browser"
                className="fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 flex flex-col gap-3 rounded-lg border bg-popover p-4 text-popover-foreground shadow-lg sm:right-auto sm:max-w-sm"
            >
                <p className="text-pretty text-sm leading-relaxed">
                    May this site remember your browser between visits? It only
                    helps us see how the site is used.
                </p>
                <div className="flex gap-2">
                    <Button
                        variant="outline"
                        onClick={() => answerConsent("given")}
                        className="flex-1 sm:flex-none sm:px-4"
                    >
                        Accept
                    </Button>
                    <Button
                        variant="outline"
                        onClick={() => answerConsent("declined")}
                        className="flex-1 sm:flex-none sm:px-4"
                    >
                        Decline
                    </Button>
                </div>
            </section>
        )
    }
}
