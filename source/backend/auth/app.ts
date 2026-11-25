import type { Access } from "./access"
import { NO_ONE_ELSE } from "./others"

// This app's own: who logs in, and what each of them may do. It's here,
// apart from the template's code (./access.ts), so an update from the
// template never meets it. START-HERE.md fills it in.

/**
 * The team, the owner first, and what each role on it may do. The people
 * below are placeholders, at example.com, which reaches nobody, so no one
 * can log in as them until they're replaced, and the seed's team is made
 * from them.
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
        // Everything there is as the template ships, area by area. An area
        // the business adds, or a later release of the template adds, is
        // the owner's alone until it's given here
        member: {
            team: "read",
            workflows: "write",
            jobs: "write",
            files: "write"
        }
    }
}

/**
 * Who else logs in here, besides the team (./others.ts): no one, as the
 * template ships. An app whose customers or members log in too puts their
 * way in here, from the feature that keeps them.
 */
export const OTHERS = NO_ONE_ELSE
