// What someone on the team may do: a level for each area of the app, which
// both sides read. The API checks it on every route that names an area
// (`permitted`, backend/auth/logged-in.ts), whichever way the request came
// in, the dashboard, Claude or an API token, and the dashboard reads the
// same levels to leave out what someone can't use. Each role's levels are
// in backend/auth/app.ts, beside the team.
//
// An area is what a person would grant, roughly a screen of the dashboard,
// never a table: one action writes many tables, and a table renamed mustn't
// change who may do what. The template's areas are below; a business adds
// its own as its app grows, like `orders`, in ./app.ts, beside this file,
// and gives each route its area.
import { APP_AREAS, APP_ROLES } from "./app"

// The template's own areas, each with what it covers
const FOUNDATION_AREAS = {
    team: "The team, as auth/app.ts lists them",
    workflows: "Workflows and their runs",
    jobs: "Jobs, which change many rows at once",
    files: "Your files, and the folders the app keeps in the bucket"
} as const

/**
 * What each area covers, as the dashboard says it: the template's, then
 * this app's own (./app.ts).
 */
export const AREAS = { ...FOUNDATION_AREAS, ...APP_AREAS }

/** An area of the app. A route names one: `permitted("workflows")`. */
export type Area = keyof typeof AREAS

/** Every area of the app, the template's first. */
// Object.keys can only say its keys are strings, but they're AREAS's own
export const AREA_NAMES = Object.keys(AREAS) as Area[]

/**
 * The roles on the team, each with what the dashboard calls it: an
 * `owner`, who may do everything, and a `member`, who may do what `roles`
 * gives them (backend/auth/app.ts), then this app's own (./app.ts).
 */
export const ROLE_NAMES = {
    owner: "Owner",
    member: "Member",
    ...APP_ROLES
} as const satisfies Record<string, string>

/** A role on the team. */
export type TeamRole = keyof typeof ROLE_NAMES

/** Every role there is, the owner's first. */
// Object.keys can only say its keys are strings, but they're ROLE_NAMES's own
export const TEAM_ROLES = Object.keys(ROLE_NAMES) as TeamRole[]

/**
 * How much someone may do in an area: `none`, nothing of it; `read`, see
 * it; `write`, see and change it. Each includes the one before it.
 */
export const LEVELS = ["none", "read", "write"] as const

export type Level = (typeof LEVELS)[number]

/** What someone may do: a level in every area. */
export type Permissions = Readonly<Record<Area, Level>>

/** Whether `permissions` reach `level` in `area`. */
export function allows(permissions: Permissions, area: Area, level: Level) {
    return LEVELS.indexOf(permissions[area]) >= LEVELS.indexOf(level)
}

/** `level` in every area. */
export function every(level: Level): Permissions {
    return eachArea(() => level)
}

/**
 * What a role is given (backend/auth/app.ts): `everything`, every area
 * there is and every one added later, or a level for each area it may
 * use, any area it leaves out being `none`, so an area added later reaches
 * no such role until it's given.
 */
export type Grant = "everything" | Partial<Permissions>

/** What a grant lets someone do, in every area. */
export function granted(grant: Grant): Permissions {
    if (grant === "everything") {
        return every("write")
    } else {
        return eachArea((area) => grant[area] ?? "none")
    }
}

/**
 * The lower of the two levels in each area: what a token may do as its
 * person, which is never more than they may, nor more than it was given.
 */
export function narrowed(first: Permissions, second: Permissions): Permissions {
    return eachArea((area) =>
        LEVELS.indexOf(first[area]) <= LEVELS.indexOf(second[area])
            ? first[area]
            : second[area]
    )
}

// Permissions with a level in every area, from what each area's is
function eachArea(levelOf: (area: Area) => Level): Permissions {
    // Object.fromEntries can only say its keys are strings, but there's an
    // entry for each of AREA_NAMES, so every area has its level
    return Object.fromEntries(
        AREA_NAMES.map((area) => [area, levelOf(area)])
    ) as Record<Area, Level>
}
