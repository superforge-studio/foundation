import { and, eq, isNull } from "drizzle-orm"
import { users } from "@/database/schema"
import type { ApiEnvironment } from "../context"
import { requestOrigin } from "../infra"
import { listedInternal, listing } from "./access"
import { TEAM_ROW_COLUMNS, type TeamMember } from "./sessions"

// Claude, logged in with a token in place of a browser's cookie: an access
// token Infra signed when one of the business's own people allowed Claude
// in on the Allow page (agents/). Infra proves whose address it is; the app
// decides what that person may do, here, on every request: they must still
// be on the team, as access.ts lists them, and Claude acts as them, with
// what their role and what they allowed both let it do. logged-in.ts calls
// this when a request has a token.

/** The token in an `Authorization: Bearer <token>` header, or null */
export function bearerToken(header: string | undefined) {
    const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "")
    return match?.[1] ?? null
}

/**
 * The team member Claude's token acts as, with the names and the role
 * access.ts lists them with, and what it may do; or undefined when the
 * token isn't one Infra signed for this app, or its address is no longer
 * listed on the team, or they've no row yet (they've never logged in, and
 * the server hasn't started since they were listed)
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
    const { email, scopes, connection_id } = checked.data
    const listed = listedInternal(access, email)
    const [row] =
        listed === undefined
            ? []
            : await database
                  .select(TEAM_ROW_COLUMNS)
                  .from(users)
                  .where(
                      and(
                          eq(users.slug, listed.slug),
                          isNull(users.deactivated_at)
                      )
                  )
    if (listed === undefined || row === undefined) {
        console.warn("Agent token for someone not on the team", {
            connection_id
        })
        return undefined
    } else {
        const user: TeamMember = { ...row, ...listing(listed) }
        return { user, scopes }
    }
}
