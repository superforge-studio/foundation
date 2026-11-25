import { and, desc, eq, gt, isNull, lt, or } from "drizzle-orm"
import type { Database } from "@/database"
import { api_tokens, users } from "@/database/schema"
import { fromNow, now } from "@/database/time"
import { DAY, MINUTE } from "@/utilities/primitives/durations"
import {
    API_TOKEN_PREFIX,
    API_TOKEN_SCOPES,
    type ApiTokenCreation
} from "@/utilities/schemas/api-tokens"
import { type Access, listedBySlug, listing } from "./access"
import { TEAM_ROW_COLUMNS, type TeamMember } from "./sessions"
import { randomCharacters, sha256 } from "./tokens"

// API tokens, in `auth.api_tokens`: what one of the business's own people
// makes on their account page for what can't log in through a browser, like
// a script, a scheduled job or another platform's agent, which sends it as
// `Authorization: Bearer api_…`. It acts as them, with the scopes they gave
// it, as Claude's token does (agents.ts), until they revoke it or it runs
// out. Made, listed and revoked from a browser only (account/routes.ts), and
// checked on every request that brings one (logged-in.ts). Nothing else
// reads this table.

// A token: the prefix, then 43 letters and digits, about 256 bits of chance
const TOKEN_LENGTH = 43
const TOKEN_SHAPE = new RegExp(
    `^${API_TOKEN_PREFIX}[0-9A-Za-z]{${TOKEN_LENGTH}}$`
)

// How much of the token's end its row keeps, to tell it apart on the page
const PREVIEW_LENGTH = 4

// A token in use notes it at most this often, which spares the table a
// write on every request a busy script makes
const NOTE_USE_EVERY = MINUTE

/**
 * Whether a bearer token is meant as an API token, by its prefix: one that
 * is never goes to Infra as Claude's would (logged-in.ts)
 */
export function isApiToken(token: string) {
    return token.startsWith(API_TOKEN_PREFIX)
}

/** A token as its person sees it: never the token itself, nor its hash */
const SHOWN_COLUMNS = {
    id: api_tokens.id,
    name: api_tokens.name,
    preview: api_tokens.preview,
    scopes: api_tokens.scopes,
    expires_at: api_tokens.expires_at,
    last_used_at: api_tokens.last_used_at,
    created_at: api_tokens.created_at
}

/**
 * Makes one of someone's tokens, and answers it with the token itself,
 * which only this answer ever has: its row keeps its SHA-256.
 */
export async function makeApiToken(
    database: Database,
    user_id: string,
    { name, scopes, expires_in_days }: ApiTokenCreation
) {
    const token = `${API_TOKEN_PREFIX}${randomCharacters(TOKEN_LENGTH)}`
    const [made] = await database
        .insert(api_tokens)
        .values({
            user_id,
            name,
            token_hash: await sha256(token),
            preview: token.slice(-PREVIEW_LENGTH),
            // Each once, in the order API_TOKEN_SCOPES has them
            scopes: API_TOKEN_SCOPES.filter((scope) => scopes.includes(scope)),
            expires_at:
                expires_in_days === null ? null : fromNow(expires_in_days * DAY)
        })
        .returning(SHOWN_COLUMNS)
    if (made === undefined) {
        throw new Error("The API token's row wasn't written")
    } else {
        return { token, api_token: made }
    }
}

/**
 * Someone's tokens, newest first, those that have run out among them, until
 * they're revoked, so a script that stopped working says why.
 */
export async function listApiTokens(database: Database, user_id: string) {
    return await database
        .select(SHOWN_COLUMNS)
        .from(api_tokens)
        .where(eq(api_tokens.user_id, user_id))
        .orderBy(desc(api_tokens.created_at))
}

/**
 * Revokes one of someone's tokens, never another person's, by deleting it,
 * so the next request with it is refused.
 */
export async function revokeApiToken(
    database: Database,
    user_id: string,
    id: string
): AsyncOperationResult<null, "not-found"> {
    const revoked = await database
        .delete(api_tokens)
        .where(and(eq(api_tokens.user_id, user_id), eq(api_tokens.id, id)))
        .returning({ id: api_tokens.id })
    if (revoked.length === 0) {
        return { ok: false, error: "not-found" }
    } else {
        return { ok: true, data: null }
    }
}

/**
 * Whom a token acts as, with the names and role access.ts lists them with,
 * and what it may do, or undefined when it isn't a live token, or its
 * person is no longer on the team: they must still be listed in
 * access.ts, by their slug, as Claude's person must, so a token stops
 * working the moment they're taken off. Notes that it was used.
 */
export async function apiTokenUser(
    database: Database,
    access: Access,
    token: string
) {
    // One that can't be a token is refused before it costs a query
    if (!TOKEN_SHAPE.test(token)) {
        return undefined
    }
    const [found] = await database
        .select({
            id: api_tokens.id,
            scopes: api_tokens.scopes,
            user: TEAM_ROW_COLUMNS
        })
        .from(api_tokens)
        .innerJoin(users, eq(api_tokens.user_id, users.id))
        .where(
            and(
                eq(api_tokens.token_hash, await sha256(token)),
                isNull(users.deactivated_at),
                or(
                    isNull(api_tokens.expires_at),
                    gt(api_tokens.expires_at, now)
                )
            )
        )
    if (found === undefined) {
        return undefined
    }
    const listed = listedBySlug(access, found.user.slug)
    if (listed === undefined) {
        console.warn("API token for someone not on the team", {
            api_token_id: found.id
        })
        return undefined
    } else {
        await noteUse(database, found.id)
        const user: TeamMember = { ...found.user, ...listing(listed) }
        return { user, scopes: found.scopes }
    }
}

// Notes a token was used now, unless it was within the last minute
async function noteUse(database: Database, id: string) {
    await database
        .update(api_tokens)
        .set({ last_used_at: now })
        .where(
            and(
                eq(api_tokens.id, id),
                or(
                    isNull(api_tokens.last_used_at),
                    lt(api_tokens.last_used_at, fromNow(-NOTE_USE_EVERY))
                )
            )
        )
}
