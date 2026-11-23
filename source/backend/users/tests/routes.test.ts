import { beforeEach, expect, test, vi } from "vitest"
import { testApi } from "@/backend/tests/support/api"
import { logInAs } from "@/backend/tests/support/login"
import { sessions } from "@/database/schema"
import { api_failure } from "@/utilities/schemas/failures"

// Everyone who can log in, through the whole API: only the business's own
// people see them or change them, and only the code changes who they are

beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {})
})

test("only the business's own people see everyone, marked when they're listed in code", async () => {
    const api = await testApi()
    const logged_out = await api.client.api.users.$get()
    expect(logged_out.status).toBe(401)

    const customer = await logInAs(api, "maria@example.com")
    const refused = await api.client.api.users.$get(
        {},
        { headers: { cookie: customer.cookie } }
    )
    expect(refused.status).toBe(403)
    expect(api_failure.parse(await refused.json()).error.reason).toBe(
        "not-internal"
    )

    const owner = await logInAs(api, "ada@example.com", "internal")
    const listed = await api.client.api.users.$get(
        {},
        { headers: { cookie: owner.cookie } }
    )
    expect(listed.status).toBe(200)
    if (listed.status === 200) {
        const { users } = await listed.json()
        expect(
            users
                .map(({ email, role, listed }) => ({ email, role, listed }))
                .sort((one, other) => one.email.localeCompare(other.email))
        ).toEqual([
            { email: "ada@example.com", role: "internal", listed: true },
            { email: "maria@example.com", role: "external", listed: false }
        ])
        expect(users.every((user) => user.sessions === 1)).toBe(true)
    }
})

test("adds someone external before they log in, once, but never someone listed", async () => {
    const api = await testApi()
    const owner = await logInAs(api, "ada@example.com", "internal")
    const headers = { headers: { cookie: owner.cookie } }
    const json = { email: " Linus@Example.com " }

    const added = await api.client.api.users.$post({ json }, headers)
    expect(added.status).toBe(201)

    const again = await api.client.api.users.$post({ json }, headers)
    expect(again.status).toBe(409)
    expect(api_failure.parse(await again.json()).error.reason).toBe("taken")

    const listed = await api.client.api.users.$post(
        { json: { email: "ADA@example.com" } },
        headers
    )
    expect(listed.status).toBe(409)
    expect(api_failure.parse(await listed.json()).error.reason).toBe("listed")

    const everyone = await api.client.api.users.$get({}, headers)
    if (everyone.status === 200) {
        const { users } = await everyone.json()
        const linus = users.find((user) => user.email === "linus@example.com")
        expect(linus).toMatchObject({ role: "external", logged_in_at: null })
    }
})

test("no one is made internal here: an internal role is refused, and the listed are changed only in code", async () => {
    const api = await testApi()
    const owner = await logInAs(api, "ada@example.com", "internal")
    const grace = await logInAs(api, "grace@example.com", "internal")
    const customer = await logInAs(api, "maria@example.com")
    const headers = { headers: { cookie: owner.cookie } }

    const kept = await api.client.api.users[":id"].$patch(
        { param: { id: customer.id }, json: { role: "external" } },
        headers
    )
    expect(kept.status).toBe(200)

    const promoting = await api.api.request(`/api/users/${customer.id}`, {
        method: "PATCH",
        headers: { cookie: owner.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ role: "internal" })
    })
    expect(promoting.status).toBe(400)
    const { error } = api_failure.parse(await promoting.json())
    expect(error.issues?.map((issue) => issue.path)).toEqual(["role"])

    for (const id of [owner.id, grace.id]) {
        const changing = await api.client.api.users[":id"].$patch(
            { param: { id }, json: { role: "external" } },
            headers
        )
        expect(changing.status).toBe(409)
        expect(api_failure.parse(await changing.json()).error.reason).toBe(
            "listed"
        )
    }

    const nobody = await api.client.api.users[":id"].$patch(
        {
            param: { id: "00000000-0000-4000-8000-000000000000" },
            json: { role: "external" }
        },
        headers
    )
    expect(nobody.status).toBe(404)
})

test("removes someone external, logging them out everywhere, but never someone listed", async () => {
    const api = await testApi()
    const owner = await logInAs(api, "ada@example.com", "internal")
    const grace = await logInAs(api, "grace@example.com", "internal")
    const customer = await logInAs(api, "maria@example.com")
    const headers = { headers: { cookie: owner.cookie } }

    const removed = await api.client.api.users[":id"].$delete(
        { param: { id: customer.id } },
        headers
    )
    expect(removed.status).toBe(200)
    expect(await api.database.select().from(sessions)).toHaveLength(2)
    const session = await api.client.api.auth.session.$get(
        {},
        { headers: { cookie: customer.cookie } }
    )
    expect(await session.json()).toEqual({ user: null })

    for (const id of [owner.id, grace.id]) {
        const refused = await api.client.api.users[":id"].$delete(
            { param: { id } },
            headers
        )
        expect(refused.status).toBe(409)
        expect(api_failure.parse(await refused.json()).error.reason).toBe(
            "listed"
        )
    }
})

test("a role that isn't one is refused", async () => {
    const api = await testApi()
    const owner = await logInAs(api, "ada@example.com", "internal")
    const response = await api.api.request("/api/users", {
        method: "POST",
        headers: { cookie: owner.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ email: "x@example.com", role: "admin" })
    })
    expect(response.status).toBe(400)
    const { error } = api_failure.parse(await response.json())
    expect(error.issues?.map((issue) => issue.path)).toEqual(["role"])
})
