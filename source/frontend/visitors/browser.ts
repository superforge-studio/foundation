import { client } from "@/backend/client"
import { rejectionError } from "./describe"
import type { Recorder, Send, SendConsent } from "./record"

// The recorder (record.ts) wired to the page and the router: the router's
// pages, the scrolling, the page hiding and coming back, the clicks and the
// errors, and the calls to the app's own /api/visits, which keeps them
// (backend/visits/). Only ever runs in a browser, from index.ts's
// `startVisitors`, which an effect calls, so never in the prerender.

/** The router, as far as the script needs it: when it's resolved a page. */
export type VisitorsRouter = {
    subscribe(
        type: "onResolved",
        listener: (event: { toLocation: { pathname: string } }) => void
    ): () => void
}

// What a click is counted on: the closest of these to what was clicked
const CLICKABLE = "a, button, [role=button], [data-track]"

/** A form's fields, whose text is never kept, here or in a comment's. */
export const FIELDS = "input, textarea, select, [contenteditable]"

/**
 * Sends a batch to the app's own /api/visits, as JSON, with the site's
 * cookies, as any call to its API goes: never to another site, and never
 * with `navigator.sendBeacon`, which ad blockers refuse.
 */
export const sendBatch: Send = async (batch, keepalive) => {
    try {
        const response = await client.api.visits.$post(
            { json: batch },
            { init: { keepalive } }
        )
        if (response.status === 200) {
            const { ask } = await response.json()
            return { status: response.status, ask }
        } else {
            return { status: response.status, ask: false }
        }
    } catch (error) {
        // Offline, or an answer the page can't read
        console.debug("Visitors: the app's server didn't answer", { error })
        return null
    }
}

/** Sends the visitor's answer to the banner to /api/visits/consent. */
export const sendConsent: SendConsent = async (consent) => {
    try {
        const response = await client.api.visits.consent.$post({
            json: { consent }
        })
        if (response.ok) {
            return true
        } else {
            console.warn("Visitors: the app's server didn't keep the answer", {
                status: response.status
            })
            return false
        }
    } catch (error) {
        console.warn("Visitors: the app's server didn't answer", { error })
        return false
    }
}

/**
 * Wires `visitors` to this page, and records the page it landed on.
 * Answers how to unwire it.
 */
export function listen(visitors: Recorder, router: VisitorsRouter) {
    visitors.begin({
        path: window.location.pathname,
        url: window.location.href,
        referrer: document.referrer,
        title: document.title,
        screen: screenSize(),
        language: navigator.language,
        visible: document.visibilityState === "visible"
    })

    let frame = 0
    // How far down the page is scrolled, once per frame at most
    function measure() {
        if (frame === 0) {
            frame = requestAnimationFrame(() => {
                frame = 0
                visitors.scrolled(scrollDepth())
            })
        }
    }
    measure()

    // Once the router has drawn the page, so its title is the new one's
    const unsubscribe = router.subscribe("onResolved", (event) => {
        guarded(() => {
            visitors.navigated(event.toLocation.pathname, document.title)
            measure()
        })
    })

    const listeners: [EventTarget, string, (event: Event) => void][] = [
        [window, "scroll", measure],
        [
            document,
            "visibilitychange",
            () => {
                if (document.visibilityState === "hidden") {
                    visitors.hidden()
                } else {
                    visitors.shown()
                }
            }
        ],
        [window, "pagehide", () => visitors.hidden()],
        [
            window,
            "pageshow",
            (event) => {
                // Back from the browser's cache, as it was left
                if (event instanceof PageTransitionEvent && event.persisted) {
                    visitors.shown()
                }
            }
        ],
        [document, "click", (event) => clicked(visitors, event)],
        [
            window,
            "error",
            (event) => {
                if (event instanceof ErrorEvent) {
                    visitors.failed({
                        message: event.message,
                        source: event.filename === "" ? null : event.filename,
                        line: event.lineno === 0 ? null : event.lineno,
                        column: event.colno === 0 ? null : event.colno
                    })
                }
            }
        ],
        [
            window,
            "unhandledrejection",
            (event) => {
                if (event instanceof PromiseRejectionEvent) {
                    visitors.failed(rejectionError(event.reason))
                }
            }
        ]
    ]
    // Each wrapped, so the script never breaks the page, nor reports its
    // own error as the page's
    const wired = listeners.map(([target, type, listener]) => {
        const handler = (event: Event) => guarded(() => listener(event))
        target.addEventListener(type, handler, { capture: true, passive: true })
        return () =>
            target.removeEventListener(type, handler, { capture: true })
    })

    return () => {
        unsubscribe()
        for (const unwire of wired) {
            unwire()
        }
        cancelAnimationFrame(frame)
        frame = 0
    }
}

// Runs `run`, logging what it throws rather than letting it reach the page
function guarded(run: () => void) {
    try {
        run()
    } catch (error) {
        console.debug("Visitors: a listener threw", { error })
    }
}

// The screen's size in CSS pixels, or null where the browser won't say
function screenSize() {
    const { width, height } = window.screen
    if (width > 0 && height > 0) {
        return { width, height }
    } else {
        return null
    }
}

// How far down the page the bottom of the window is, 0 to 100: all of it
// for a page that doesn't scroll
function scrollDepth() {
    const height = document.documentElement.scrollHeight
    if (height <= 0) {
        return 100
    } else {
        return ((window.scrollY + window.innerHeight) / height) * 100
    }
}

// A click on a link, a button, or anything named with `data-track`: what
// it is, never what's typed in a field
function clicked(visitors: Recorder, event: Event) {
    if (!(event.target instanceof Element)) {
        return
    }
    // Not the visitor's, like the toolbar the logged-in see
    if (event.target.closest("[data-untracked]") !== null) {
        return
    }
    const element = event.target.closest(CLICKABLE)
    if (element === null) {
        return
    }
    const tag = element.tagName.toLowerCase()
    visitors.clicked(
        {
            tag,
            name: element.getAttribute("data-track"),
            label: element.getAttribute("aria-label"),
            text: element.textContent ?? "",
            href: tag === "a" ? element.getAttribute("href") : null,
            private:
                element.matches(FIELDS) ||
                element.closest("[data-private]") !== null
        },
        window.location.href
    )
}
