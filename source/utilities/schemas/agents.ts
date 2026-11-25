import { AGENT_SCOPES } from "@superforge/infra/contract"
import { z } from "zod"

/**
 * Where the app's own MCP answers: under `/admin`, since it's for the
 * business's own people, as the admin is. `/mcp` is left free on purpose,
 * for an MCP the business may give its customers one day, logged in as one
 * of them: Infra signs each of Claude's tokens for the address Claude asked
 * to use, so one MCP's tokens never open the other (backend/mcp/README.md).
 */
export const MCP_PATH = "/admin/mcp"

/**
 * What someone on the team lets Claude do in the app, as they allow it on
 * the Allow page: `read`, the API's `GET` routes, and `act`, everything
 * else they could do themselves, but log anyone in or out. The API
 * enforces both on every call Claude makes (backend/auth/logged-in.ts).
 * Infra's contract defines them, since its tokens carry them.
 */
export { AGENT_SCOPES, type AgentScope } from "@superforge/infra/contract"

/**
 * What the Allow page sends: what Claude may do, of what it asked. Built
 * with the app's own zod from the package's list, since the package's
 * schemas are made with its own zod, which can be another version.
 */
export const agent_allow = z.object({
    scopes: z.array(z.enum(AGENT_SCOPES)).min(1)
})
