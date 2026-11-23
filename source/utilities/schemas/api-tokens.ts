import { z } from "zod"
import { agent_scope } from "./agents"

// API tokens, which one of the business's own people makes on their account
// page for what can't log in through a browser, like a script, a scheduled
// job or another platform's agent: what the page sends to make one, checked
// on both sides (backend/auth/api-tokens.ts).

/**
 * What every API token starts with: how the API tells one from Claude's,
 * which Infra signs, without asking anything, and what to search for when
 * one may have leaked
 */
export const API_TOKEN_PREFIX = "api_"

/** How many days a token may last, for one that's to run out */
export const API_TOKEN_LIFETIMES = [30, 90, 365] as const

export type ApiTokenLifetime = (typeof API_TOKEN_LIFETIMES)[number]

/** What a token's called, so its person knows what holds it */
export const api_token_name = z.string().trim().min(1).max(80)

/**
 * What makes a token: its name, what it may do (`read`, and `act`, as
 * Claude's may, utilities/schemas/agents.ts), and how many days it lasts,
 * or null, as it's left, for one that lasts until it's revoked
 */
export const api_token_creation = z.object({
    name: api_token_name,
    scopes: z.array(agent_scope).min(1),
    expires_in_days: z.literal(API_TOKEN_LIFETIMES).nullable().default(null)
})

export type ApiTokenCreation = z.infer<typeof api_token_creation>
