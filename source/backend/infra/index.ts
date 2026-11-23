import type { z } from "zod"
import type { AgentScope } from "@/utilities/schemas/agents"
import type { LoginProof } from "@/utilities/schemas/auth"
import type {
    AgentConnection,
    AgentToken,
    agent_refused,
    agent_request
} from "./agents"
import type {
    comment_refused,
    kept_comment,
    start_refused,
    started_login,
    verified_login,
    verify_refused
} from "./answers"
import { chooseInfra } from "./choose"
import type { FiledComment } from "./comments"

// Superforge Infra, the backend services this app runs on, through the one
// wrapper every route and step calls: never a bare `fetch` to it anywhere
// else (workbench/writing-code.md, "A call to an outside service"). For now
// it's login, where Infra emails a visitor a code and a link, and says
// whether what they brought back is right; comments, what the app's people
// said about it from the toolbar; and Claude's login to the app's MCP.
// The app keeps its own users and sessions (backend/auth/), and its own
// analytics (backend/visits/). README.md here has the calls.

/** What the app asks of Infra, whichever answers: the real one or the stand-in. */
export type Infra = {
    /**
     * Emails `email` a six-digit code, and a link back to the app's
     * `/login` when `origin` is one of the project's domains or
     * localhost. `ip` is the visitor's, which Infra's limits count.
     */
    startLogin(request: {
        email: string
        ip: string
        origin: string | null
    }): AsyncOperation<StartedLogin, StartRefused | InfraUnavailable>
    /**
     * Whose email `proof` is: the code typed with the address it went to,
     * or the link's token. Either works once.
     */
    verifyLogin(
        proof: LoginProof
    ): AsyncOperation<
        z.output<typeof verified_login>,
        VerifyRefused | InfraUnavailable
    >
    /**
     * Sends Infra a comment someone logged in wrote about an element of a
     * page, which the toolbar posted to the app's own /api/comments, with
     * who they are (comments.ts). Infra keeps it, a test key's too, and
     * answers its ID. It's never retried: a comment sent twice is kept
     * twice.
     */
    fileComment(
        comment: FiledComment
    ): AsyncOperation<KeptComment, CommentRefused | InfraUnavailable>

    // Claude logging in to the app's MCP, Infra being the OAuth server
    // (agents.ts, and Infra's README, "Claude")

    /**
     * Passes one of Claude's OAuth calls through to Infra (`path`, after
     * `/oauth`: `/authorize`, `/token`, `/metadata`…), with the app's
     * key and `origin`, and answers what Infra answers, as it is
     */
    passOAuth(request: Request, path: string, origin: string): Promise<Response>
    /** What the Allow page shows of a request Claude made */
    agentRequest(
        request_id: string
    ): AsyncOperation<AgentRequest, AgentRefused | InfraUnavailable>
    /**
     * Someone on the team, by their email, allowed Claude's request: where
     * their browser goes back to Claude, with the one-time code
     */
    allowAgent(
        request_id: string,
        allowed: { email: string; scopes: AgentScope[] }
    ): AsyncOperation<{ redirect_to: string }, AgentRefused | InfraUnavailable>
    /** Someone declined it: where their browser goes back to Claude */
    denyAgent(
        request_id: string
    ): AsyncOperation<{ redirect_to: string }, AgentRefused | InfraUnavailable>
    /** Someone's connections, oldest first, for their Connected list */
    agentConnections(
        email: string
    ): AsyncOperation<AgentConnection[], InfraUnavailable>
    /** Ends one connection: Claude can't refresh it */
    endAgentConnection(
        connection_id: string
    ): AsyncOperation<null, AgentRefused | InfraUnavailable>
    /** Ends all of someone's, as taking them off the team does */
    endAgentConnections(email: string): AsyncOperation<number, InfraUnavailable>
    /**
     * Whom a token Claude brings acts as, and what it may do, when Infra
     * signed it for this app at `origin`, checked with Infra's public keys
     */
    checkAgentToken(
        token: string,
        origin: string
    ): AsyncOperation<AgentToken, "invalid-token" | InfraUnavailable>
}

// What Infra answers, as the app sees it (answers.ts has each field)
export type StartedLogin = z.output<typeof started_login>
export type StartRefused = z.output<typeof start_refused>
export type VerifyRefused = z.output<typeof verify_refused>
export type KeptComment = z.output<typeof kept_comment>
export type CommentRefused = z.output<typeof comment_refused>
export type AgentRequest = z.output<typeof agent_request>["request"]
export type AgentRefused = z.output<typeof agent_refused>
export type { AgentConnection, AgentToken, FiledComment }

/**
 * Infra couldn't be asked: no key in a build, a key it refused, or an
 * answer that didn't come or didn't make sense. Each is logged where it
 * happens, so the visitor only learns that login isn't working.
 */
export type InfraUnavailable = { reason: "unavailable" }

let shared: Infra | undefined

/**
 * The server's Infra, chosen the first time it's asked for (choose.ts): the
 * real one with the secret key in a build, the real one with a test key in
 * a dev server that has one, and the stand-in in a dev server that
 * doesn't. A build never gets the stand-in.
 */
export function appInfra(): Infra {
    if (shared === undefined) {
        shared = chooseInfra({
            development: import.meta.env.DEV,
            environment: process.env,
            checkout: process.cwd()
        }).infra
    }
    return shared
}
