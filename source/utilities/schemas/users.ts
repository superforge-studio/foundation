import { z } from "zod"

// The team, the business's own people, who are listed in code
// (backend/auth/access.ts), and nobody else logs in: a slug, as the list
// is checked with and the database's check is made from.

/**
 * A team member's slug in access.ts: lowercase words joined by hyphens,
 * `ada` or `nick-r`, which the database's check is made from too.
 */
export const USER_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/
export const user_slug = z.string().max(60).regex(USER_SLUG_PATTERN)
