import { eq } from "drizzle-orm"
import { users } from "@/database/schema"
import { isInternal } from "@/utilities/schemas/users"
import type { ApiEnvironment } from "../context"
import { requestOrigin } from "../infra/agents"
import { roleFor } from "./access"
import { SESSION_USER_COLUMNS } from "./sessions"

// Claude, logged in with a token in place of a browser's cookie: an access
// token Infra signed when one of the business's own people allowed Claude
// in on the Allow page (agents/). Infra proves whose address it is; the app
// decides what that person may do, here, on every request: they must still
// be one of the business's own, as access.ts lists them, and Claude acts as
// them, with what they allowed. logged-in.ts calls this when a request has
// a token.

/** The token in an `Authorization: Bearer <token>` header, or null */
export function bearerToken(header: string | undefined) {
    const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "")
    return match?.[1] ?? null
}

/**
 * Whom Claude's token acts as, and what it may do, or undefined when the
 * token isn't one Infra signed for this app, or its person is no longer
 * one of the business's own
 */
export async function agentUser(
    { database, access, infra }: ApiEnvironment["Variables"],
    token: string,
    request_url: string
) {
    const checked = await infra.checkAgentToken(
        token,
        requestOrigin(request_url)
    )
    if (!checked.ok) {
        return undefined
    }
    const { email, scopes } = checked.data
    const [user] = await database
        .select(SESSION_USER_COLUMNS)
        .from(users)
        .where(eq(users.email, email.trim().toLowerCase()))
    const role =
        user === undefined ? undefined : roleFor(access, user.email, user.role)
    if (user === undefined || role === undefined || !isInternal(role)) {
        console.warn("Agent token for someone not on the team", {
            connection_id: checked.data.connection_id
        })
        return undefined
    } else {
        return { user: { ...user, role }, scopes }
    }
}
