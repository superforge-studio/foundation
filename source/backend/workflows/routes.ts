import { Hono } from "hono"
import { z } from "zod"
import { internalOnly } from "../auth/logged-in"
import type { ApiEnvironment } from "../context"
import { failure, validated } from "../failures"

// A run's id in a path: whatever DBOS was given, or made
const run_path = z.object({ id: z.string().min(1).max(200) })

/**
 * The workflows' runs, under /api/workflows, for the dashboard's Workflows
 * screen, which asks again every few seconds while it's open: only the
 * business's own people may (`internalOnly`). They're read through
 * `context.var.workflows`, so through DBOS's own functions, never its
 * tables (engine.ts).
 */
export const workflowRoutes = new Hono<ApiEnvironment>()
    .get("/workflows/runs", internalOnly, async (context) => {
        const runs = await context.var.workflows.runs()
        return context.json({ runs }, 200)
    })

    .get(
        "/workflows/runs/:id",
        internalOnly,
        validated("param", run_path),
        async (context) => {
            const run = await context.var.workflows.run(
                context.req.valid("param").id
            )
            if (run === null) {
                return failure(context, 404, "not-found", "No such run")
            } else {
                return context.json({ run }, 200)
            }
        }
    )

    // Runs a failed or canceled run again, from the step it stopped at
    .post(
        "/workflows/runs/:id/retry",
        internalOnly,
        validated("param", run_path),
        async (context) => {
            const { id } = context.req.valid("param")
            const retried = await context.var.workflows.retry(id)
            if (retried.ok) {
                console.info("A run was retried", {
                    id,
                    by: context.var.user.id
                })
                return context.json({ retried: true as const }, 200)
            } else if (retried.error === "not-stopped") {
                return failure(
                    context,
                    409,
                    retried.error,
                    "Only a run that failed or was canceled can run again"
                )
            } else {
                return failure(context, 404, retried.error, "No such run")
            }
        }
    )
