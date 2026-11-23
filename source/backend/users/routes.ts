import { Hono } from "hono"
import { z } from "zod"
import { user_addition, user_change } from "@/utilities/schemas/users"
import { listedInternal } from "../auth/access"
import { inBrowser, internalOnly } from "../auth/logged-in"
import type { ApiEnvironment } from "../context"
import { failure, validated } from "../failures"
import { addUser } from "./add"
import { changeRole } from "./change"
import { findUser } from "./find"
import { listUsers } from "./list"
import { removeUser } from "./remove"

// Someone's id in a path
const user_path = z.object({ id: z.uuid() })

// What someone hears when they try to change or remove one of the
// business's own, whom only the code changes
const LISTED =
    "They're listed as internal in the app's code (backend/auth/access.ts), so only a change there changes them"

/**
 * Everyone who can log in, under /api/users, for the dashboard's People
 * screen: only the business's own people may (`internalOnly`), and no one
 * changes or removes themselves, so there's always someone who can. Only
 * external people are added, changed and removed here: the internal ones
 * are listed in code (auth/access.ts), and are refused 409 `listed`.
 */
export const userRoutes = new Hono<ApiEnvironment>()
    .get("/users", internalOnly, async (context) => {
        const users = await listUsers(context.var.database, context.var.access)
        return context.json({ users }, 200)
    })

    // Someone added before they log in, with their role, one of the
    // external ones
    .post(
        "/users",
        internalOnly,
        inBrowser,
        validated("json", user_addition),
        async (context) => {
            const addition = context.req.valid("json")
            if (listedInternal(context.var.access, addition.email)) {
                return failure(context, 409, "listed", LISTED)
            }
            const added = await addUser(context.var.database, addition)
            if (added.ok) {
                console.info("Someone was added", {
                    id: added.data.id,
                    by: context.var.user.id
                })
                return context.json(added.data, 201)
            } else {
                return failure(
                    context,
                    409,
                    added.error,
                    "Someone with this address is already here"
                )
            }
        }
    )

    .patch(
        "/users/:id",
        internalOnly,
        inBrowser,
        validated("param", user_path),
        validated("json", user_change),
        async (context) => {
            const { id } = context.req.valid("param")
            if (await listed(context.var.database, context.var.access, id)) {
                return failure(context, 409, "listed", LISTED)
            }
            const changed = await changeRole(context.var.database, {
                id,
                role: context.req.valid("json").role,
                by: context.var.user.id
            })
            if (changed.ok) {
                return context.json({ changed: true as const }, 200)
            } else if (changed.error === "yourself") {
                return failure(
                    context,
                    409,
                    changed.error,
                    "Someone else changes your role"
                )
            } else {
                return failure(context, 404, changed.error, "No such person")
            }
        }
    )

    .delete(
        "/users/:id",
        internalOnly,
        inBrowser,
        validated("param", user_path),
        async (context) => {
            const { id } = context.req.valid("param")
            if (await listed(context.var.database, context.var.access, id)) {
                return failure(context, 409, "listed", LISTED)
            }
            const removed = await removeUser(context.var.database, {
                id,
                by: context.var.user.id
            })
            if (removed.ok) {
                console.info("Someone was removed", {
                    id,
                    by: context.var.user.id
                })
                return context.json({ removed: true as const }, 200)
            } else if (removed.error === "yourself") {
                return failure(
                    context,
                    409,
                    removed.error,
                    "Someone else removes you"
                )
            } else {
                return failure(context, 404, removed.error, "No such person")
            }
        }
    )

// Whether the person with this id is one of the business's own, listed in
// code
async function listed(
    database: ApiEnvironment["Variables"]["database"],
    access: ApiEnvironment["Variables"]["access"],
    id: string
) {
    const user = await findUser(database, id)
    return user !== null && listedInternal(access, user.email) !== undefined
}
