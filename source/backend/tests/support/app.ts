import type { AppVariables } from "@/backend/app"

/**
 * What a test's API gets of this app's own on `context` (backend/app.ts):
 * for each of `AppVariables`, the test's own when it hands one
 * (`replacing`), or else a stand-in that reaches nothing outside the test,
 * as the template's are in ./api.ts. Each leaves the template as it
 * ships until a test says otherwise, so the template's own tests hold:
 * no one but the team logs in, whatever `OTHERS` could let in
 * (backend/auth/app.ts), unless the test opens the way. `looks` is
 * whatever a test reads back from those stand-ins, like the messages a
 * sender's was handed, which `testApi()` answers beside its own.
 */
export function appTestVariables(_replacing: Partial<AppVariables>): {
    variables: AppVariables
    looks: Record<never, never>
} {
    return { variables: {}, looks: {} }
}

/**
 * This app's own routes that anyone may call, and why each may, beside the
 * template's (`ANYONE`, ../routes.test.ts), like a form's
 * `"POST /api/quotes": "A visitor asking for a quote"`. Every other route
 * of the app's says who may call it.
 */
export const APP_ANYONE: Record<string, string> = {}

/**
 * Whether `handler` is a check of this app's own that says who may call a
 * route, beside the template's `loggedIn`, `maybeLoggedIn` and `permitted`:
 * the check a second kind of person who logs in gets (auth/others.ts), if
 * the app has one.
 */
export function appSaysWhoMayCall(_handler: unknown) {
    return false
}
