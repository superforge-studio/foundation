import { eq } from "drizzle-orm"
import { beforeEach, expect, test, vi } from "vitest"
import { ACCESS } from "@/backend/auth/app"
import { testApi } from "@/backend/tests/support/api"
import { logInAs } from "@/backend/tests/support/login"
import { users } from "@/database/schema"
import { api_failure } from "@/utilities/schemas/failures"

// The team, through the whole API: whoever's role may read the team sees
// it, as auth/app.ts lists it, and nothing here changes anyone

beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {})
})

test("whoever may read the team sees it, with the role each is listed with, and those taken off it", async () => {
    const api = await testApi()
    const logged_out = await api.client.api.users.$get()
    expect(logged_out.status).toBe(401)

    const owner = await logInAs(api, "ada@example.com")
    await logInAs(api, "grace@example.com", "member")
    await api.database.insert(users).values({
        slug: "linus",
        email: "linus@example.com",
        deactivated_at: new Date()
    })

    const listed = await api.client.api.users.$get(
        {},
        { headers: { cookie: owner.cookie } }
    )
    expect(listed.status).toBe(200)
    if (listed.status === 200) {
        const { users } = await listed.json()
        expect(
            users
                .map(({ slug, role, listed, deactivated_at }) => ({
                    slug,
                    role,
                    listed,
                    active: deactivated_at === null
                }))
                .sort((one, other) => one.slug.localeCompare(other.slug))
        ).toEqual([
            { slug: "ada", role: "owner", listed: true, active: true },
            { slug: "grace", role: "member", listed: true, active: true },
            { slug: "linus", role: null, listed: false, active: false }
        ])
    }
})

test("someone whose role can't read the team is refused, saying what it needed", async () => {
    const api = await testApi({
        access: {
            internal_users: [],
            roles: { ...ACCESS.roles, member: { workflows: "read" } }
        }
    })
    const member = await logInAs(api, "grace@example.com", "member")
    const refused = await api.client.api.users.$get(
        {},
        { headers: { cookie: member.cookie } }
    )
    expect(refused.status).toBe(403)
    expect(api_failure.parse(await refused.json()).error).toMatchObject({
        reason: "not-permitted",
        area: "team",
        level: "read"
    })
})

test("someone taken off the list is logged out, whatever their row says", async () => {
    const api = await testApi()
    const ada = await logInAs(api, "ada@example.com")
    api.internal_users.splice(0)
    const refused = await api.client.api.users.$get(
        {},
        { headers: { cookie: ada.cookie } }
    )
    expect(refused.status).toBe(401)
    const [row] = await api.database
        .select({ id: users.id })
        .from(users)
        .where(eq(users.slug, "ada"))
    expect(row?.id).toBe(ada.id)
})
