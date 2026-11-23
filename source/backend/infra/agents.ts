import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from "jose"
import { z } from "zod"
import { SECOND } from "@/utilities/primitives/durations"
import {
    AGENT_SCOPES,
    type AgentScope,
    MCP_PATH
} from "@/utilities/schemas/agents"

// Claude logging in to the app's own MCP, through Infra: Infra is the OAuth
// server, and the app only checks the tokens it signs, with Infra's public
// keys, never asking Infra (Infra's README, "Claude"). This is what of it
// the app's Infra wrapper uses: where the app was reached, which every
// token is bound to, passing Claude's OAuth calls through, what Infra
// answers about its requests and connections, and checking a token.

/**
 * Where a request reached the app: `https://vmdsystem.com`, or plain http
 * on this computer, as a dev server is. Behind Railway's proxy a request's
 * own address says http though the browser's said https, so only the host
 * counts. Every token Claude holds is bound to it, as its issuer, and with
 * the MCP's path (`MCP_PATH`), its audience.
 */
export function requestOrigin(request_url: string) {
    const { host, hostname } = new URL(request_url)
    const local =
        ["localhost", "127.0.0.1", "[::1]"].includes(hostname) ||
        hostname.endsWith(".localhost")
    return local ? `http://${host}` : `https://${host}`
}

/** The header Infra reads the app's origin from, on a call passed through */
export const APP_ORIGIN_HEADER = "App-Origin"

// What a call passed through may carry on, of the request Claude or the
// browser sent: what the body is, and what Claude accepts back
const PASSED_HEADERS = ["accept", "content-type"]

/**
 * Passes one of Claude's OAuth calls through to Infra's `/v1/oauth/…`
 * (`path`), with the app's key and origin, and answers Infra's answer as
 * it is: its status, its body, and where it sends the browser. The request
 * is Claude's or the browser's, unread.
 */
export async function passThrough({
    url,
    key,
    send,
    request,
    path,
    origin
}: {
    url: string
    key: string
    send: typeof fetch
    request: Request
    path: string
    origin: string
}) {
    const { search } = new URL(request.url)
    const headers = new Headers({
        Authorization: `Bearer ${key}`,
        [APP_ORIGIN_HEADER]: origin
    })
    for (const name of PASSED_HEADERS) {
        const value = request.headers.get(name)
        if (value !== null) {
            headers.set(name, value)
        }
    }
    const body =
        request.method === "GET" || request.method === "HEAD"
            ? undefined
            : await request.text()
    try {
        const answer = await send(`${url}/oauth${path}${search}`, {
            method: request.method,
            headers,
            body,
            redirect: "manual",
            signal: AbortSignal.timeout(15 * SECOND)
        })
        console.info("Infra answered", {
            call: `/oauth${path}`,
            status: answer.status
        })
        const passed = new Headers({ "Cache-Control": "no-store" })
        for (const name of ["content-type", "location"]) {
            const value = answer.headers.get(name)
            if (value !== null) {
                passed.set(name, value)
            }
        }
        return new Response(await answer.arrayBuffer(), {
            status: answer.status,
            headers: passed
        })
    } catch (error) {
        console.error("Infra didn't answer", { call: `/oauth${path}`, error })
        return unavailableOAuth()
    }
}

/**
 * What a call passed through answers when Infra can't be asked, as RFC
 * 6749 has it, so Claude says login isn't working rather than looping
 */
export function unavailableOAuth() {
    return Response.json(
        {
            error: "temporarily_unavailable",
            error_description: "The app can't reach Infra to log Claude in"
        },
        { status: 503, headers: { "Cache-Control": "no-store" } }
    )
}

// What Infra answers about Claude's requests and connections (its README,
// "Claude"), as the app reads it

export const agent_request = z.object({
    request: z.object({
        id: z.string(),
        client_name: z.string(),
        scopes: z.array(z.enum(AGENT_SCOPES)),
        expires_at: z.coerce.date()
    })
})

export const agent_redirect = z.object({ redirect_to: z.url() })

export const agent_connections = z.object({
    connections: z.array(
        z.object({
            id: z.string(),
            email: z.string(),
            client_name: z.string(),
            scopes: z.array(z.enum(AGENT_SCOPES)),
            last_used_at: z.coerce.date(),
            created_at: z.coerce.date()
        })
    )
})

export const agent_ended = z.object({ ended: z.number().int() })

/** Which project the key is for, and its mode: `GET /v1/project` */
export const infra_project = z.object({
    project: z.object({ id: z.string() }),
    mode: z.enum(["live", "test"])
})

export const agent_refused = z.object({
    error: z.enum(["not-found", "not-asked"])
})

/** Someone's connection, as the Connected list shows it */
export type AgentConnection = z.output<
    typeof agent_connections
>["connections"][number]

/** What the app learns from a token Claude brings, once it's checked */
export type AgentToken = {
    /** Whom Claude acts as: the app checks them against its team */
    email: string
    /** What they let Claude do */
    scopes: AgentScope[]
    /** Which of their connections it is, to end it */
    connection_id: string
}

// The claims Infra's tokens carry beyond the standard ones (Infra's README)
const agent_claims = z.object({
    sub: z.string(),
    scope: z.string(),
    project: z.string(),
    mode: z.enum(["live", "test"]),
    connection: z.string()
})

/** Where a token's signature is checked: Infra's published public keys */
export function infraKeys(url: string): JWTVerifyGetKey {
    return createRemoteJWKSet(
        new URL("/.well-known/jwks.json", new URL(url).origin),
        { timeoutDuration: 10 * SECOND, cooldownDuration: 30 * SECOND }
    )
}

/**
 * Checks a token Claude brings, as Infra's README says to: Infra signed it,
 * for this app's origin and its MCP (`MCP_PATH`), for this project in the key's
 * mode, and it hasn't run out. `project` is the app's own project ID and
 * mode, as `GET /v1/project` answers them.
 */
export async function checkToken(
    keys: JWTVerifyGetKey,
    token: string,
    expected: { origin: string; project: string; mode: "live" | "test" }
): AsyncOperation<AgentToken, "invalid-token"> {
    try {
        const { payload } = await jwtVerify(token, keys, {
            issuer: expected.origin,
            audience: `${expected.origin}${MCP_PATH}`,
            algorithms: ["ES256"]
        })
        const claims = agent_claims.safeParse(payload)
        if (
            !claims.success ||
            claims.data.project !== expected.project ||
            claims.data.mode !== expected.mode
        ) {
            console.warn("Agent token not for this app", {
                origin: expected.origin
            })
            return { ok: false, error: "invalid-token" }
        } else {
            const said = claims.data.scope.split(" ")
            return {
                ok: true,
                data: {
                    email: claims.data.sub,
                    scopes: AGENT_SCOPES.filter((scope) =>
                        said.includes(scope)
                    ),
                    connection_id: claims.data.connection
                }
            }
        }
    } catch (error) {
        console.info("Agent token refused", { origin: expected.origin, error })
        return { ok: false, error: "invalid-token" }
    }
}
