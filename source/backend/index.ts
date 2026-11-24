import { type Context, Hono } from "hono"
import { csrf } from "hono/csrf"
import { createMiddleware } from "hono/factory"
import { appDatabase } from "@/database"
import { appStorage } from "@/database/storage"
import { traceRoutes } from "@/utilities/tracing"
import { VISITOR_MODE } from "@/utilities/visitors"
import { accountRoutes } from "./account/routes"
import { agentRoutes } from "./agents/routes"
import { appRoutes, appVariables, takesFormsFromOtherSites } from "./app"
import { ACCESS } from "./auth/access"
import { authRoutes } from "./auth/routes"
import { commentRoutes } from "./comments/routes"
import type { ApiEnvironment } from "./context"
import { answerNotFound, answerUnexpected } from "./failures"
import { fileRoutes } from "./files/routes"
import { healthRoutes } from "./health/routes"
import { appInfra } from "./infra"
import { jobRoutes } from "./jobs/routes"
import { userRoutes } from "./users/routes"
import { appLocate } from "./visits/location"
import { visitRoutes } from "./visits/routes"
import { webhookRoutes } from "./webhooks/routes"
import { SOURCES } from "./webhooks/sources"
import { dbosWorkflows } from "./workflows/engine"
import { workflowRoutes } from "./workflows/routes"

/**
 * The API under /api, with what every route sees on its `context`
 * (context.ts): the server's, below, or a test's own, with a database of
 * the test's (tests/support/api.ts). Each feature's routes are a Hono app of
 * their own, in its folder's `routes.ts`: the template's mounted here, and
 * this app's own after them, from ./app.ts (`appRoutes`).
 */
export function apiWith(variables: () => ApiEnvironment["Variables"]) {
    return (
        new Hono<ApiEnvironment>()
            .basePath("/api")

            // Each request's span named for the route it matched, and a
            // request an MCP's tool makes in-process a span inside its
            // (utilities/tracing.ts)
            .use(traceRoutes)

            // The database on `context.var.database` for every route, the
            // Storage bucket on `context.var.storage`, the workflows on
            // `context.var.workflows`, Infra on `context.var.infra`, who
            // can log in on `context.var.access`, whom the site remembers
            // on `context.var.visitor_mode`, what places a visitor on
            // `context.var.locate`, the services that post the app
            // webhooks on `context.var.webhook_sources`, and whatever this
            // app adds of its own (./app.ts). Nothing under /api is kept in
            // Railway's cache (source/node.ts), so each request reaches the
            // server.
            .use(withVariables(variables))
            .use(async (context, next) => {
                await next()
                context.header("Cache-Control", "no-store")
            })

            // Webhooks other services post, under /webhooks, ahead of the
            // check below: their signature says who sent them, and some
            // senders post forms with no Origin (webhooks/)
            .route("/", webhookRoutes)

            // A form on another site can post to any address, with the
            // visitor's cookies when it's a top-level navigation: refuse
            // the kinds of body a form sends (403, failures.ts) unless the
            // browser says the request came from this site. JSON, which a
            // form can't send, is left alone, and so is a request that says
            // nothing of its body, like a script's bodiless POST, since a
            // form always says, and so is any method but POST, which a form
            // can't send, like a script's PUT of a .txt file. A route of
            // the app's that must take one says so (./app.ts).
            .use((context, next) =>
                context.req.method !== "POST" ||
                context.req.header("Content-Type") === undefined ||
                takesFormsFromOtherSites(context.req.method, context.req.path)
                    ? next()
                    : refuseCrossSiteForms(context, next)
            )

            // Every failure in the one shape (failures.ts): a path no route
            // answers, and a route that threw
            .notFound(answerNotFound)
            .onError(answerUnexpected)

            // Whether the server can reach its database
            .route("/", healthRoutes)

            // Logging in, through Infra, and out, under /auth
            .route("/", authRoutes)

            // The logged-in person's own account, under /account
            .route("/", accountRoutes)

            // What visitors do on the pages, which the pages' script posts
            // under /visits, kept in the app's own database
            .route("/", visitRoutes)

            // What the logged-in say about the app, from the toolbar on
            // every page, under /comments, sent on to Infra
            .route("/", commentRoutes)

            // The business's side of the dashboard, for its own people:
            // everyone who can log in, under /users, and the workflows'
            // runs, under /workflows
            .route("/", userRoutes)
            .route("/", workflowRoutes)

            // The changes to the app's data someone starts on purpose, each
            // a dry run first, under /jobs (jobs/)
            .route("/", jobRoutes)

            // Everything in the app's bucket, under /files: Your files, the
            // team's own, and the folders the app keeps for itself (files/)
            .route("/", fileRoutes)

            // Claude connecting to the app's MCP: the Allow page, under
            // /connect, and someone's connections, under
            // /account/connections (agents/)
            .route("/", agentRoutes)

            // This app's own routes, after the template's (app.ts)
            .route("/", appRoutes)
    )
}

/**
 * The middleware that puts `variables()` on `context`, each by its name, as
 * `apiWith()` does for every route: a test's own Hono app takes it too, with
 * its test API's (`testApi().variables`), so its routes see everything the
 * API's do, this app's own among them.
 */
export function withVariables(variables: () => ApiEnvironment["Variables"]) {
    return createMiddleware<ApiEnvironment>(async (context, next) => {
        const given = variables()
        // Object.keys can only say its keys are strings, but they're the
        // variables' own
        for (const name of Object.keys(given) as VariableName[]) {
            put(context, given, name)
        }
        await next()
    })
}

type VariableName = keyof ApiEnvironment["Variables"]

// Puts one of what every route sees on its `context`, by its name
function put<Name extends VariableName>(
    context: Context<ApiEnvironment>,
    given: ApiEnvironment["Variables"],
    name: Name
) {
    context.set(name, given[name])
}

const refuseCrossSiteForms = csrf({ origin: fromThisHost })

// Whether a request's Origin is this site: by its host alone, since behind
// Railway's proxy the request's own address says http, and the browser's
// https
function fromThisHost(origin: string, context: Context) {
    return (
        URL.canParse(origin) &&
        new URL(origin).host === new URL(context.req.url).host
    )
}

/**
 * What the server's own API sees on `context`: its database, bucket,
 * workflows and Infra, with who can log in as auth/access.ts says, whom
 * the site remembers as utilities/visitors.ts says, visitors placed by the
 * database Railway names (visits/location.ts), the webhook sources
 * webhooks/sources.ts lists, and this app's own (./app.ts). Whatever else
 * the server answers with the same things takes this too.
 */
export function serverVariables(): ApiEnvironment["Variables"] {
    return {
        database: appDatabase(),
        storage: appStorage(),
        workflows: dbosWorkflows,
        infra: appInfra(),
        access: ACCESS,
        visitor_mode: VISITOR_MODE,
        locate: appLocate(),
        webhook_sources: SOURCES,
        ...appVariables()
    }
}

/** The server's API. */
export const api = apiWith(serverVariables)

export type AppType = typeof api
