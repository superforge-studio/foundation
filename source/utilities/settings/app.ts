import type { Settings } from "."

// Relative, since drizzle-kit reads this file through schema.ts, without
// the app's `@/` paths

/**
 * This app's own settings: only those it changes from the template's
 * (./index.ts, `TEMPLATE_SETTINGS`, which says what each does), so a
 * setting a later release adds, or a default it changes, reaches this app
 * without an update ever meeting what's here. START-HERE.md sets the
 * first, like:
 *
 *   export const APP_SETTINGS: Partial<Settings> = {
 *       site_title: "Acme Plumbing",
 *       site_description: "Plumbers in Olympia, Washington, since 1998.",
 *       visitor_mode: "ask-in-eu"
 *   }
 */
export const APP_SETTINGS: Partial<Settings> = {}
