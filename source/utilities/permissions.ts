// What someone on the team may do: a level for each area of the app, which
// both sides read. The API checks it on every route that names an area
// (`permitted`, backend/auth/logged-in.ts), whichever way the request came
// in, the dashboard, Claude or an API token, and the dashboard reads the
// same levels to leave out what someone can't use. Each role's levels are
// in backend/auth/access.ts, beside the team.
//
// An area is what a person would grant, roughly a screen of the dashboard,
// never a table: one action writes many tables, and a table renamed mustn't
// change who may do what. A business adds its own areas as its app grows,
// like `orders`, to AREA_NAMES and AREAS, and gives each route its area.

/** Every area of the app. A route names one: `permitted("workflows")`. */
export const AREA_NAMES = ["team", "workflows", "jobs", "files"] as const

export type Area = (typeof AREA_NAMES)[number]

/** What each area covers, as the dashboard says it */
export const AREAS: Readonly<Record<Area, string>> = {
    team: "The team, as access.ts lists them",
    workflows: "Workflows and their runs",
    jobs: "Jobs, which change many rows at once",
    files: "Your files, and the folders the app keeps in the bucket"
}

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
 * What a role is given (backend/auth/access.ts): `everything`, every area
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
