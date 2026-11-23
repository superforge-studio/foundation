import type { TeamRole } from "@/backend/auth/access"
import {
    AREA_NAMES,
    AREAS,
    type Level,
    type Permissions
} from "@/utilities/permissions"

// What a role lets someone do, as the admin shows it: on their account, and
// on each person on the Team screen. The levels are the API's, which it
// checks on every route whatever this shows (utilities/permissions/).

/** What each role is called on screen. A role a business adds goes here. */
export const ROLE_NAMES: Record<TeamRole, string> = {
    owner: "Owner",
    member: "Member"
}

/** What each level means, as a person reads it. */
const LEVEL_WORDS: Record<Level, string> = {
    none: "Can't see",
    read: "Can see",
    write: "Can see and change"
}

/** Each area of the app, what it covers, and how much these allow of it. */
export function AreaLevels({ permissions }: { permissions: Permissions }) {
    return (
        <dl className="flex flex-col divide-y rounded-lg border text-sm">
            {AREA_NAMES.map((area) => (
                <div
                    key={area}
                    className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-4 py-3"
                >
                    <dt className="flex min-w-0 flex-col">
                        <span className="font-medium capitalize">{area}</span>
                        <span className="text-pretty text-muted-foreground text-xs">
                            {AREAS[area]}
                        </span>
                    </dt>
                    <dd
                        className={
                            permissions[area] === "none"
                                ? "text-muted-foreground"
                                : "text-foreground"
                        }
                    >
                        {LEVEL_WORDS[permissions[area]]}
                    </dd>
                </div>
            ))}
        </dl>
    )
}
