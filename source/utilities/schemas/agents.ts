import { z } from "zod"

/**
 * Where the app's own MCP answers: under `/admin`, since it's for the
 * business's own people, as the admin is. `/mcp` is left free on purpose,
 * for an MCP the business may give its customers one day, logged in as one
 * of them, with tokens of its own: Infra signs each token for one path, so
 * one MCP's tokens never open the other. Until there is one, Infra logs
 * Claude in to this path alone (backend/mcp/README.md).
 */
export const MCP_PATH = "/admin/mcp"

/**
 * What someone on the team lets Claude do in the app, as they allow it on
 * the Allow page: `read`, the API's `GET` routes, and `act`, everything
 * else they could do themselves, but log anyone in or out. The API
 * enforces both on every call Claude makes (backend/auth/logged-in.ts).
 */
export const AGENT_SCOPES = ["read", "act"] as const

export const agent_scope = z.enum(AGENT_SCOPES)

export type AgentScope = z.infer<typeof agent_scope>

/** What the Allow page sends: what Claude may do, of what it asked */
export const agent_allow = z.object({
    scopes: z.array(agent_scope).min(1)
})
