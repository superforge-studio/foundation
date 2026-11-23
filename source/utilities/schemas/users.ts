import { z } from "zod"
import { email_address } from "./auth"

// The people who can log in, as the dashboard and the routes under
// /api/users check them (backend/users/routes.ts): the same schemas on both
// sides, so a form says what's wrong before it sends.

/**
 * Who someone is to the business: one of its own (`internal`), who sees
 * the whole dashboard, or anyone else (`external`), a customer or a client,
 * who sees only their own account. Only the people listed in code are ever
 * internal (`internal_users`, backend/auth/access.ts); everyone else has
 * one of the external roles. A business that needs more adds them to one
 * of the two lists, like `technician` to INTERNAL_ROLES or `lead` to
 * EXTERNAL_ROLES; the column's check (database/schema.ts) is made from
 * both, so the migration `pnpm database:generate` writes changes it with
 * them.
 */
export const INTERNAL_ROLES = ["internal"] as const
export const EXTERNAL_ROLES = ["external"] as const
export const ROLES = [...INTERNAL_ROLES, ...EXTERNAL_ROLES] as const
export const user_role = z.enum(ROLES)
export type Role = z.infer<typeof user_role>
export type InternalRole = (typeof INTERNAL_ROLES)[number]
export type ExternalRole = (typeof EXTERNAL_ROLES)[number]

/**
 * The roles someone can be given on the People screen: the external ones,
 * since only the code makes anyone internal.
 */
export const external_role = z.enum(EXTERNAL_ROLES)

/**
 * Whether someone in `role` sees the business's side of the dashboard (the
 * people, the workflows), on top of their own account. Everyone else sees
 * only theirs.
 */
export function isInternal(role: Role): role is InternalRole {
    return INTERNAL_ROLES.some((internal) => internal === role)
}

/** Someone's name, as they'd like it shown: trimmed, and not too long. */
export const person_name = z.string().trim().min(1).max(120)

/** What changes someone's own details, on their account page. */
export const account_change = z.object({ name: person_name.nullable() })

/**
 * Someone added by hand, before they've logged in: their address, a name
 * if it's known, and their role, one of the external ones.
 */
export const user_addition = z.object({
    email: email_address,
    name: person_name.optional(),
    role: external_role.default(EXTERNAL_ROLES[0])
})

/**
 * What an internal person can change about someone else: their role,
 * another of the external ones.
 */
export const user_change = z.object({ role: external_role })
