import { z } from "zod"

// The team, the business's own people, as the Team screen and the
// account page check them (backend/users/, backend/account/): the same
// schemas on both sides. They're listed in code (backend/auth/access.ts),
// and nobody else logs in.

/**
 * A team member's slug in access.ts: lowercase words joined by hyphens,
 * `ada` or `nick-r`, which the database's check is made from too.
 */
export const USER_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/
export const user_slug = z.string().max(60).regex(USER_SLUG_PATTERN)

/** A team member's ID, a uuid. */
export const user_id = z.uuid()
