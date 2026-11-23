import { Hono } from "hono"
import type { ApiEnvironment } from "./context"

// This app's own part of the API, beside the template's (./index.ts): its
// routes, and what its routes see on `context`. They're here so an update
// from the template never meets them: a feature of the business's is a
// folder of its own in backend/, and this file is where the API learns of
// it. Its workflows go in ./workflows/app.ts and its jobs in ./jobs/app.ts.

/**
 * What this app's routes see on `context`, beside the template's
 * (./context.ts): one wrapper for each outside service the app calls, like
 * `{ payments: Payments }`. Each needs the server's own, from
 * `appVariables` below, and a test's, from tests/support/app.ts.
 */
export type AppVariables = Record<never, never>

/** The server's own of each `AppVariables`, which ./index.ts puts on `context`. */
export function appVariables(): AppVariables {
    return {}
}

/**
 * This app's routes, mounted after the template's (./index.ts), each
 * feature's a Hono app of its own in its folder's `routes.ts`:
 *
 *   export const appRoutes = new Hono<ApiEnvironment>()
 *       .route("/", orderRoutes)
 *       .route("/", quoteRoutes)
 *
 * In one chain, so the typed client knows them (./client.ts).
 */
export const appRoutes = new Hono<ApiEnvironment>()

/**
 * Whether a form on another site may post to this route: none may, as the
 * template ships, since a form carries the visitor's cookies (./index.ts,
 * `csrf()`). One that must take one, like the address a mail app posts a
 * one-click unsubscribe to, is named here by its method and path, and
 * checks who's asking some other way.
 */
export function takesFormsFromOtherSites(_method: string, _path: string) {
    return false
}
