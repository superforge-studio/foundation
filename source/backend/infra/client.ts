import type { z } from "zod"
import { SECOND } from "@/utilities/primitives/durations"
import {
    agent_connections,
    agent_ended,
    agent_redirect,
    agent_refused,
    agent_request,
    checkToken,
    infra_project,
    infraKeys,
    passThrough
} from "./agents"
import {
    comment_refused,
    kept_comment,
    start_refused,
    started_login,
    verified_login,
    verify_refused
} from "./answers"
import type { AgentRefused, Infra, InfraUnavailable } from "./index"

/**
 * Infra's API, which a project's keys call. A server can be pointed at
 * another Infra with `INFRA_URL` (choose.ts).
 */
export const INFRA_URL = "https://infra.superforge.studio/v1"

// How long a call waits for Infra's answer. Starting a login waits on
// Infra sending the email, which takes a second or two.
const TIMEOUT = 15 * SECOND

const UNAVAILABLE: InfraUnavailable = { reason: "unavailable" }

/**
 * Infra, called over HTTP with a project's key: a secret key in a build, a
 * test key in a dev server. No call is retried, since none is safe to send
 * twice (a second start sends a second email, a second verify finds the
 * code spent, and a comment sent again is kept twice); the visitor asks
 * again instead. `send` is `fetch`, or a test's own.
 */
export function infraClient({
    key,
    url = INFRA_URL,
    send = fetch
}: {
    key: string
    url?: string
    send?: typeof fetch
}): Infra {
    // One call: its status and its JSON, or null when it never answered or
    // answered something that isn't JSON, which is logged
    async function ask(
        method: "GET" | "POST" | "DELETE",
        call: string,
        body?: unknown
    ) {
        const response = await send(`${url}${call}`, {
            method,
            headers:
                body === undefined
                    ? { Authorization: `Bearer ${key}` }
                    : {
                          Authorization: `Bearer ${key}`,
                          "Content-Type": "application/json"
                      },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(TIMEOUT)
        }).catch((error: unknown) => {
            console.error("Infra didn't answer", { call, error })
            return null
        })
        if (response === null) {
            return null
        }
        const json: unknown = await response.json().catch((error: unknown) => {
            console.error("Infra answered without JSON", {
                call,
                status: response.status,
                error
            })
            return undefined
        })
        if (json === undefined) {
            return null
        } else {
            console.info("Infra answered", { call, status: response.status })
            return { status: response.status, json }
        }
    }
    const post = (call: string, body: unknown) => ask("POST", call, body)

    // Claude's login (agents.ts): Infra's public keys, fetched once and
    // again for a key they don't have, and which project and mode the key
    // is, which every token must be for, asked once
    const keys = infraKeys(url)
    let project: ReturnType<typeof projectOf> | undefined
    async function projectOf() {
        const answer = await ask("GET", "/project")
        const parsed = infra_project.safeParse(answer?.json)
        if (answer?.status === 200 && parsed.success) {
            return parsed.data
        } else {
            console.error("Infra didn't say which project the key is", {
                status: answer?.status
            })
            return null
        }
    }

    // A call about Claude's requests and connections: its answer, or why
    // Infra refused it, or that it couldn't be asked
    async function agents<Schema extends z.ZodType>(
        method: "GET" | "POST" | "DELETE",
        call: string,
        schema: Schema,
        body?: unknown
    ): AsyncOperation<z.output<Schema>, AgentRefused | InfraUnavailable> {
        const answer = await ask(method, call, body)
        if (answer === null) {
            return { ok: false, error: UNAVAILABLE }
        } else if (answer.status === 200) {
            const parsed = schema.safeParse(answer.json)
            return parsed.success
                ? { ok: true, data: parsed.data }
                : unexpected(call, answer)
        } else {
            const parsed = agent_refused.safeParse(answer.json)
            return parsed.success
                ? { ok: false, error: parsed.data }
                : unexpected(call, answer)
        }
    }

    return {
        async startLogin({ email, ip, origin }) {
            const call = "/login/start"
            const answer = await post(
                call,
                origin === null ? { email, ip } : { email, ip, origin }
            )
            if (answer === null) {
                return { ok: false, error: UNAVAILABLE }
            } else if (answer.status === 200) {
                const parsed = started_login.safeParse(answer.json)
                if (parsed.success) {
                    return { ok: true, data: parsed.data }
                } else {
                    return unexpected(call, answer)
                }
            } else {
                const parsed = start_refused.safeParse(answer.json)
                if (parsed.success) {
                    return { ok: false, error: parsed.data }
                } else {
                    return unexpected(call, answer)
                }
            }
        },

        async verifyLogin(proof) {
            const call = "/login/verify"
            const answer = await post(call, proof)
            if (answer === null) {
                return { ok: false, error: UNAVAILABLE }
            } else if (answer.status === 200) {
                const parsed = verified_login.safeParse(answer.json)
                if (parsed.success) {
                    return { ok: true, data: parsed.data }
                } else {
                    return unexpected(call, answer)
                }
            } else {
                const parsed = verify_refused.safeParse(answer.json)
                if (parsed.success) {
                    return { ok: false, error: parsed.data }
                } else {
                    return unexpected(call, answer)
                }
            }
        },

        async fileComment(comment) {
            const call = "/comments"
            const answer = await post(call, comment)
            if (answer === null) {
                return { ok: false, error: UNAVAILABLE }
            } else if (answer.status === 201) {
                const parsed = kept_comment.safeParse(answer.json)
                if (parsed.success) {
                    return { ok: true, data: parsed.data }
                } else {
                    return unexpected(call, answer)
                }
            } else {
                const parsed = comment_refused.safeParse(answer.json)
                if (parsed.success) {
                    // What the app sent is wrong, which only a change here
                    // fixes
                    console.error("Infra refused a comment", {
                        call,
                        status: answer.status,
                        refused: parsed.data
                    })
                    return { ok: false, error: parsed.data }
                } else {
                    return unexpected(call, answer)
                }
            }
        },

        passOAuth(request, path, origin) {
            return passThrough({ url, key, send, request, path, origin })
        },

        async agentRequest(request_id) {
            const asked = await agents(
                "GET",
                `/agents/requests/${request_id}`,
                agent_request
            )
            return asked.ok ? { ok: true, data: asked.data.request } : asked
        },

        allowAgent(request_id, allowed) {
            return agents(
                "POST",
                `/agents/requests/${request_id}/allow`,
                agent_redirect,
                allowed
            )
        },

        denyAgent(request_id) {
            return agents(
                "POST",
                `/agents/requests/${request_id}/deny`,
                agent_redirect,
                {}
            )
        },

        async agentConnections(email) {
            const query = new URLSearchParams({ email })
            const listed = await agents(
                "GET",
                `/agents/connections?${query}`,
                agent_connections
            )
            if (listed.ok) {
                return { ok: true, data: listed.data.connections }
            } else {
                return { ok: false, error: UNAVAILABLE }
            }
        },

        async endAgentConnection(connection_id) {
            const ended = await agents(
                "DELETE",
                `/agents/connections/${connection_id}`,
                agent_ended
            )
            return ended.ok ? { ok: true, data: null } : ended
        },

        async endAgentConnections(email) {
            const query = new URLSearchParams({ email })
            const ended = await agents(
                "DELETE",
                `/agents/connections?${query}`,
                agent_ended
            )
            if (ended.ok) {
                return { ok: true, data: ended.data.ended }
            } else {
                return { ok: false, error: UNAVAILABLE }
            }
        },

        async checkAgentToken(token, origin) {
            project ??= projectOf()
            const known = await project
            if (known === null) {
                project = undefined
                return { ok: false, error: UNAVAILABLE }
            } else {
                return await checkToken(keys, token, {
                    origin,
                    project: known.project.id,
                    mode: known.mode
                })
            }
        }
    }
}

// An answer the app doesn't expect: a key Infra refused (401, which an
// owner fixes in Railway), a body this app sent wrong (400 `invalid`, a
// bug here), or something Infra has never answered. Logged with what it
// said, and unavailable to the visitor.
function unexpected(call: string, answer: { status: number; json: unknown }) {
    if (answer.status === 401) {
        console.error(
            "Infra refused the key: set a working one as INFRA_SECRET_KEY",
            { call, answer: answer.json }
        )
    } else {
        console.error("Infra answered what the app doesn't expect", {
            call,
            status: answer.status,
            answer: answer.json
        })
    }
    return { ok: false as const, error: UNAVAILABLE }
}
