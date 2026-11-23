import type { Context } from "hono"
import type { ApiEnvironment } from "../context"

/**
 * What else this app checks before it says it's healthy, after the
 * template's check that the server reaches its database (./routes.ts):
 * nothing, as the template ships. Railway's healthcheck asks, and a new
 * deployment has to pass before it takes traffic, so a check here is for
 * what the new code can't run without, never for a service that's down
 * for a while. It answers the failure (`failure()`, 503), or null when
 * all is well.
 */
export async function appHealth(_context: Context<ApiEnvironment>) {
    return null
}
