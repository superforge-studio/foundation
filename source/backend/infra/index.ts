import { chooseInfra, type Infra, type InfraChoice } from "@superforge/infra"

// Superforge Infra, the backend services this app runs on, through
// @superforge/infra, the package every app calls it with: login, where
// Infra emails a visitor a code and a link, and says whether what they
// brought back is right; comments, what the app's people said about it
// from the toolbar; and Claude's login to the app's MCP. Every route and
// step calls it here, never with a bare `fetch` (workbench/writing-code.md,
// "A call to an outside service"), and the rest of the app imports what it
// needs of the package from here, so this is the one seam to it. The one
// exception is what Claude may do, `AGENT_SCOPES`, which the pages check
// too, so utilities/schemas/agents.ts takes it from the package's contract,
// `@superforge/infra/contract`, which needs nothing of Node's. The app
// keeps its own users and sessions (backend/auth/), and its own analytics
// (backend/visits/). README.md here has the calls.

export {
    type AgentConnection,
    type AgentToken,
    APP_PATHS,
    type FiledComment,
    type Infra,
    type InfraProject,
    type InfraUnavailable,
    infraClient,
    OAUTH_CALLS,
    type OAuthCall,
    requestOrigin,
    standInAgentToken,
    standInInfra
} from "@superforge/infra"

/**
 * Which Infra the server calls: Infra itself, with the `"secret key"` in a
 * build or a `"test key"` in a dev server; its `"stand-in"`, in a dev
 * server with no test key it can use, and in the tests; or `"nothing"`,
 * with no key it may use, as in a build with no secret key, where every
 * call answers unavailable.
 */
export type InfraUsing = InfraChoice["using"]

let shared: InfraChoice | undefined

// What the server calls, chosen the first time it's asked for
function serverChoice(): InfraChoice {
    if (shared === undefined) {
        shared = chooseInfra({
            development: import.meta.env.DEV,
            environment: process.env,
            checkout: process.cwd()
        })
    }
    return shared
}

/**
 * The server's Infra, chosen the first time it's asked for: the real one
 * with the secret key in a build, the real one with a test key in a dev
 * server that has one, and the stand-in in a dev server that doesn't. A
 * build never gets the stand-in; without a secret key, every call answers
 * unavailable with why (README.md, "Keys").
 */
export function appInfra(): Infra {
    return serverChoice().infra
}

/**
 * Which one `appInfra()` is, which says whether a comment filed here
 * reaches Infra at all: the stand-in keeps none (../comments/board.ts).
 */
export function appInfraUsing(): InfraUsing {
    return serverChoice().using
}
