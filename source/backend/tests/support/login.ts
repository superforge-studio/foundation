import type { TeamRole } from "@/backend/auth/access"
import type { testApi } from "./api"

/**
 * Logs `email` in through the whole API, as a person does, with Infra's
 * stand-in, which answers the code, as one of the team in `role`, an
 * `owner` unless it says: what a route's test calls to act as someone.
 * They're listed first, unless they already are, as access.ts would list
 * them, named for their address (`ada@example.com` is Ada Example, slug
 * `ada`). Answers their
 * user's id and the `cookie` header their browser would send.
 */
export async function logInAs(
    api: Awaited<ReturnType<typeof testApi>>,
    email: string,
    role: TeamRole = "owner"
) {
    const [local = email, domain = ""] = email.split("@")
    const listed = api.internal_users.some(
        (each) => each.email.toLowerCase() === email.toLowerCase()
    )
    if (!listed) {
        api.internal_users.push({
            slug: local.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-"),
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
