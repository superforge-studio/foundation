import { type Grant, granted } from "@/utilities/permissions"
import { user_slug } from "@/utilities/schemas/users"

/**
 * Who can log in, and what each of them may do: the team, the business's
 * own people, whom START-HERE.md asks the owner for, and what each role on
 * it is given. They're code rather than Railway variables or rows someone
 * adds on a screen, so a dev server logs in the way production does, and
 * the team only changes with a commit. Every route sees them on
 * `context.var.access`, and a test can hand its own
 * (backend/tests/support/api.ts).
 */
export type Access = {
    /**
     * The team, the owner first: the only users there are, and the only
     * people who log in. Adding someone here lets them log in from the next
     * deploy. Taking them off deactivates them as the server starts,
     * ending their sessions and API tokens, while what they did keeps
     * pointing at them; listing them again with the same slug brings them
     * back, as a new address does, once Infra has ended Claude's
     * connections as them (backend/users/sync.ts).
     */
    internal_users: readonly InternalUser[]
    /**
     * What each role may do, area by area (utilities/permissions/):
     * `everything`, or a level for each area the role may use, the rest
     * being `none`. Every route that names an area checks it, and the
     * dashboard leaves out what someone can't use.
     */
    roles: Readonly<Record<TeamRole, Grant>>
}

/**
 * The roles on the team: an `owner`, who may do everything, and a
 * `member`, who may do what `roles` gives them. A business that needs
 * another, like `technician`, adds it here and gives it its areas in
 * `roles`.
 */
export const TEAM_ROLES = ["owner", "member"] as const
export type TeamRole = (typeof TEAM_ROLES)[number]

/** One of the business's own people, as ACCESS lists them. */
export type InternalUser = {
    /**
     * Who they are to the code, which never changes and is never given to
     * anyone else: lowercase words joined by hyphens, like `ada` or
     * `nick-r`. Their row follows it, so a new address changes their row
     * rather than making a new one, and ends every way in their old one
     * had: their sessions, their API tokens and Claude's connections. So
     * someone new gets a slug of their own, never the one of the person
     * they replace.
     */
    slug: string
    first_name: string
    last_name: string
    /** The address they log in with, in any case: it's compared lowercased. */
    email: string
    /** Their role (`TEAM_ROLES`): a `member` when it's left out. */
    role?: TeamRole
}

/**
 * This app's. START-HERE.md sets them: the people below are placeholders,
 * at example.com, which reaches nobody, so no one can log in as them until
 * they're replaced, and the seed's team is made from them.
 */
export const ACCESS: Access = {
    internal_users: [
        {
            slug: "ada",
            first_name: "Ada",
            last_name: "Lovelace",
            email: "ada@example.com",
            role: "owner"
        },
        {
            slug: "grace",
            first_name: "Grace",
            last_name: "Hopper",
            email: "grace@example.com"
        }
    ],
    roles: {
        owner: "everything",
        // Everything there is as the template ships, area by area, so an
        // area the business adds is the owner's alone until it's given here
        member: {
            team: "read",
            workflows: "write",
            jobs: "write",
            files: "write"
        }
    }
}

/** A listed person's address, as their row keeps it: trimmed and lowercased. */
export function addressOf(listed: InternalUser) {
    return listed.email.trim().toLowerCase()
}

/** The team member listed with `email`, if anyone is. */
export function listedInternal(access: Access, email: string) {
    const address = email.trim().toLowerCase()
    return access.internal_users.find((listed) => addressOf(listed) === address)
}

/** The team member listed with `slug`, if anyone is. */
export function listedBySlug(access: Access, slug: string) {
    return access.internal_users.find((listed) => listed.slug === slug)
}

/**
 * The team member a row is, if the list has it as it is: its slug, with
 * its address. A row whose slug is listed with another address is no
 * one's, so whatever its old address let in stops counting at the deploy
 * that changes it, before the server's start ends it (users/sync.ts). Every
 * check of who's asking asks this.
 */
export function listedAs(access: Access, row: { slug: string; email: string }) {
    const listed = listedBySlug(access, row.slug)
    if (listed === undefined || addressOf(listed) !== row.email) {
        return undefined
    } else {
        return listed
    }
}

/** A listed person's name, as the app shows it. */
export function nameOf(listed: InternalUser) {
    return `${listed.first_name.trim()} ${listed.last_name.trim()}`.trim()
}

/** A listed person's role. */
export function roleOf(listed: InternalUser): TeamRole {
    return listed.role ?? "member"
}

/** What someone in `role` may do, in every area. */
export function permissionsOf(access: Access, role: TeamRole) {
    return granted(access.roles[role])
}

/**
 * What the list says of someone, which their row doesn't keep: their
 * name, their first and last names, and their role. A logged-in team
 * member carries these from the list, so a change to it holds from the
 * next request.
 */
export function listing(listed: InternalUser) {
    return {
        name: nameOf(listed),
        first_name: listed.first_name.trim(),
        last_name: listed.last_name.trim(),
        role: roleOf(listed)
    }
}

/**
 * What's wrong with a list, or an empty array when nothing is: a slug
 * that isn't lowercase words joined by hyphens, or a slug or an address
 * listed twice. The sync refuses a list that has any
 * (backend/users/sync.ts), and a test checks ACCESS, so a mistake fails
 * `pnpm check` rather than a deploy.
 */
export function problemsWith(access: Access) {
    const problems: string[] = []
    const slugs = new Set<string>()
    const emails = new Set<string>()
    for (const listed of access.internal_users) {
        const email = listed.email.trim().toLowerCase()
        if (!user_slug.safeParse(listed.slug).success) {
            problems.push(`"${listed.slug}" isn't a slug`)
        }
        if (slugs.has(listed.slug)) {
            problems.push(`The slug "${listed.slug}" is listed twice`)
        }
        if (emails.has(email)) {
            problems.push(`${email} is listed twice`)
        }
        slugs.add(listed.slug)
        emails.add(email)
    }
    return problems
}
