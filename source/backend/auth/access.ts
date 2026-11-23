import {
    type InternalRole,
    isInternal,
    type Role
} from "@/utilities/schemas/users"

/**
 * Who can log in, and who the business's own people are: the two
 * questions START-HERE.md asks the owner, whose answers go in ACCESS below.
 * They're code rather than Railway variables or rows someone adds on a
 * screen, so a dev server logs in the way production does, and the team
 * only changes with a commit. Every route sees them on
 * `context.var.access`, and a test can hand its own
 * (backend/tests/support/api.ts).
 */
export type Access = {
    /**
     * `anyone`: logging in for the first time makes the person, as
     * `external`, for a business whose customers log in. `listed`: only
     * someone in `internal_users`, or added on the dashboard's People
     * screen, can log in, for an app only the business's own people use.
     */
    login: "anyone" | "listed"
    /**
     * The business's own people, the owner first: the only people who are
     * ever internal. Someone listed here is internal whatever the database
     * says, and someone who isn't never is: no screen, route or login can
     * make anyone else internal. Adding someone here lets them log in, as
     * internal, from the next deploy; taking them off makes them
     * `external` from their next request.
     */
    internal_users: readonly InternalUser[]
}

/** One of the business's own people, as ACCESS lists them. */
export type InternalUser = {
    first_name: string
    last_name: string
    /** The address they log in with, in any case: it's compared lowercased. */
    email: string
    /**
     * Which of the internal roles they have (`INTERNAL_ROLES`), for a
     * business that has more than one, like `technician`: `internal` when
     * left out.
     */
    role?: InternalRole
}

/**
 * This app's. START-HERE.md sets them: the people below are placeholders,
 * at example.com, which reaches nobody, so no one can log in as them until
 * they're replaced, and the seed's internal users are made from them.
 */
export const ACCESS: Access = {
    login: "anyone",
    internal_users: [
        {
            first_name: "Ada",
            last_name: "Lovelace",
            email: "ada@example.com"
        },
        {
            first_name: "Grace",
            last_name: "Hopper",
            email: "grace@example.com"
        }
    ]
}

/** The internal user listed with `email`, if anyone is. */
export function listedInternal(access: Access, email: string) {
    const address = email.trim().toLowerCase()
    return access.internal_users.find(
        (listed) => listed.email.trim().toLowerCase() === address
    )
}

/** A listed person's name, as the app shows it. */
export function nameOf(listed: InternalUser) {
    return `${listed.first_name.trim()} ${listed.last_name.trim()}`.trim()
}

/** A listed person's role: the one they're listed with, or `internal`. */
export function listedRole(listed: InternalUser): InternalRole {
    return listed.role ?? "internal"
}

/**
 * The role someone with `email` has, whatever the database says
 * (`stored`): the one they're listed with when they're in
 * `internal_users`, `external` when they aren't but the database says
 * they're internal (taken off the list, or made so by hand), and what's
 * stored otherwise. The login middleware reads every user through this,
 * so only the list makes anyone internal (logged-in.ts).
 */
export function roleFor(access: Access, email: string, stored: Role): Role {
    const listed = listedInternal(access, email)
    if (listed !== undefined) {
        return listedRole(listed)
    } else if (isInternal(stored)) {
        return "external"
    } else {
        return stored
    }
}
