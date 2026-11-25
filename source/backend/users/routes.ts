import { Hono } from "hono"
import { permitted } from "../auth/logged-in"
import type { ApiEnvironment } from "../context"
import { listUsers } from "./list"

/**
 * The team, under /api/users, for the admin's Settings: whoever
 * may read the team (`permitted("team")`), and nothing here changes anyone,
 * since the team is listed in code (auth/access.ts) and the database
 * follows it (sync.ts).
 */
export const userRoutes = new Hono<ApiEnvironment>().get(
    "/users",
    permitted("team"),
    async (context) => {
        const users = await listUsers(context.var.database, context.var.access)
        return context.json({ users }, 200)
    }
)
