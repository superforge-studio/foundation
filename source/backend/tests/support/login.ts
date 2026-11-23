import { eq } from "drizzle-orm"
import { users } from "@/database/schema"
import { isInternal, type Role } from "@/utilities/schemas/users"
import type { testApi } from "./api"

/**
 * Logs `email` in through the whole API, as a person does, with Infra's
 * stand-in, which answers the code, as `role`: what a route's test calls
 * to act as someone. An internal role lists them first, as access.ts
 * would, named for their address (`ada@example.com` is Ada Example); any
 * other is set on their row. Answers their user's id and the `cookie`
 * header their browser would send.
 */
export async function logInAs(
    api: Awaited<ReturnType<typeof testApi>>,
    email: string,
    role: Role = "external"
) {
    if (isInternal(role)) {
        const [local = email, domain = ""] = email.split("@")
        api.internal_users.push({
            first_name: capitalized(local),
            last_name: capitalized(domain.split(".")[0] ?? ""),
            email,
            role
        })
    }
    const started = await api.client.api.auth.start.$post({ json: { email } })
    if (started.status !== 200) {
        throw new Error("The test's login didn't start")
    }
    const { development } = await started.json()
    if (development === null) {
        throw new Error("The stand-in answers the code")
    }
    const verified = await api.client.api.auth.verify.$post(
        { json: { email, code: development.code } },
        { headers: { "User-Agent": "Test browser" } }
    )
    if (verified.status !== 200) {
        throw new Error("The test's login didn't verify")
    }
    const { user } = await verified.json()
    if (!isInternal(role)) {
        await api.database
            .update(users)
            .set({ role })
            .where(eq(users.id, user.id))
    }
    return { id: user.id, cookie: sessionCookie(verified) }
}

// A word with its first letter capitalized
function capitalized(word: string) {
    return word.charAt(0).toUpperCase() + word.slice(1)
}

/** The `session` cookie a response set, as a request sends it back. */
export function sessionCookie(response: Response) {
    const set = response.headers.get("Set-Cookie") ?? ""
    const match = /(?:^|,\s*)session=([^;]*)/.exec(set)
    if (match?.[1] === undefined) {
        throw new Error("The response set no session cookie")
    } else {
        return `session=${match[1]}`
    }
}
