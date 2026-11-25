import type { TeamRole } from "@/backend/auth/access"
import {
    AREA_NAMES,
    AREAS,
    type Level,
    type Permissions
} from "@/utilities/permissions"
import { roleName } from "./words"

// What a role lets someone do, as the admin shows it: on their account,
// and each role on the team in Settings. The levels are the API's, which
// it checks on every route whatever this shows (utilities/permissions/).

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

/**
 * Each area of the app, and how much each of these roles may do in it, a
 * column a role.
 */
export function RoleLevels({
    roles
}: {
    roles: readonly { role: TeamRole; permissions: Permissions }[]
}) {
    return (
        <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full min-w-[20rem] text-sm">
                <thead>
                    <tr className="border-b text-left text-muted-foreground text-xs">
                        <th scope="col" className="px-4 py-2.5 font-medium">
                            Area
                        </th>
                        {roles.map(({ role }) => (
                            <th
                                key={role}
                                scope="col"
                                className="px-4 py-2.5 font-medium"
                            >
                                {roleName(role)}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody className="divide-y">
                    {AREA_NAMES.map((area) => (
                        <tr key={area}>
                            <th
                                scope="row"
                                className="px-4 py-3 text-left align-top font-normal"
                            >
                                <span className="block font-medium capitalize">
                                    {area}
                                </span>
                                <span className="block text-pretty text-muted-foreground text-xs">
                                    {AREAS[area]}
                                </span>
                            </th>
                            {roles.map(({ role, permissions }) => (
                                <td
                                    key={role}
                                    className={
                                        permissions[area] === "none"
                                            ? "px-4 py-3 align-top text-muted-foreground"
                                            : "px-4 py-3 align-top"
                                    }
                                >
                                    {LEVEL_WORDS[permissions[area]]}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}
