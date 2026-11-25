import { and, eq, isNull } from "drizzle-orm"
import { z } from "zod"
import { users } from "@/database/schema"
import { MCP_PATH } from "@/utilities/schemas/agents"
import type { ApiEnvironment } from "../context"
import { requestOrigin } from "../infra"
import { listedBySlug, listing } from "./access"
import { TEAM_ROW_COLUMNS, type TeamMember } from "./sessions"

// Claude, logged in with a token in place of a browser's cookie: an access
// token Infra signed when one of the business's own people allowed Claude
// in on the Allow page (agents/), naming them by their user's ID, which
// never changes. Infra proves who allowed it; the app decides what that
// person may do, here, on every request: they must still be on the team,
// as access.ts lists them, by their slug, and Claude acts as them, with
// what their role and what they allowed both let it do. logged-in.ts calls
// this when a request has a token.

// Three base64url parts, header, claims and signature, as every JWT is
const JWT_SHAPE = /^[\w-]+\.[\w-]+\.[\w-]+$/

/** The token in an `Authorization: Bearer <token>` header, or null */
export function bearerToken(header: string | undefined) {
    const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "")
    return match?.[1] ?? null
}

/**
 * The team member Claude's token acts as, with the names and the role
 * access.ts lists them with, and what it may do; `"unavailable"` when
 * Infra's keys couldn't be fetched to check it, which isn't the token's
 * fault (answered 503, so Claude tries again rather than logging in
 * again); or undefined when the token isn't one Infra signed for this
 * app's MCP, names neither scope the app knows, or its user is deactivated
 * or no longer listed on the team
 */
export async function agentUser(
    { database, access, infra }: ApiEnvironment["Variables"],
    token: string,
    request_url: string
) {
    // A JWT is three dot-separated parts: anything else is no one's, and
    // never costs a call to Infra
    if (!JWT_SHAPE.test(token)) {
        return undefined
    }
    const origin = requestOrigin(request_url)
    const checked = await infra.checkAgentToken(token, {
        origin,
        resource: `${origin}${MCP_PATH}`
    })
    if (!checked.ok) {
        return checked.error.reason === "unavailable"
            ? "unavailable"
            : undefined
    }
    const { user_id, scopes, connection_id } = checked.data
    // A token that names neither `read` nor `act` may do nothing, so it's
    // no one's rather than a reader's
    if (scopes.length === 0) {
        console.warn("Agent token with no scope the app knows", {
            connection_id
        })
        return undefined
    }
    // A user's row ID, which a token Infra signed always names; anything
    // else is no one's, and never reaches the query
    const id = z.uuid().safeParse(user_id)
    const [row] = !id.success
        ? []
        : await database
              .select(TEAM_ROW_COLUMNS)
              .from(users)
              .where(and(eq(users.id, id.data), isNull(users.deactivated_at)))
    const listed =
        row === undefined ? undefined : listedBySlug(access, row.slug)
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
