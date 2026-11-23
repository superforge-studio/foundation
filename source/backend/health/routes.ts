import { Hono } from "hono"
import type { ApiEnvironment } from "../context"
import { failure } from "../failures"
import { appHealth } from "./app"
import { checkDatabase } from "./check"

// Whether the server can reach the database: Railway's healthcheck, which a
// new deployment has to pass before it takes traffic (.railway/railway.ts),
// and the home page's status line. As every route does, it checks what came
// in (nothing, here), calls an operation, and answers what it said. What
// else this app checks is in ./app.ts.
export const healthRoutes = new Hono<ApiEnvironment>().get(
    "/health",
    async (context) => {
        const checked = await checkDatabase(context.var.database)
        if (!checked.ok) {
            return failure(
                context,
                503,
                checked.error,
                "The server can't reach its database"
            )
        }
        const unwell = await appHealth(context)
        if (unwell === null) {
            return context.json({ ok: true as const })
        } else {
            return unwell
        }
    }
)
