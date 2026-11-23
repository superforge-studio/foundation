import { Hono } from "hono"
import { z } from "zod"
import { permitted } from "../auth/logged-in"
import type { ApiEnvironment } from "../context"
import { failure, validated } from "../failures"
import { JOBS } from "./index"

// The jobs, under /api/jobs, for whoever's role may (`permitted("jobs")`):
// what there is, to whoever may read them, and starting one, a dry run
// first, to whoever may write them. Claude reaches them through the MCP's
// call_api as the person who let it in, and needs `act` to (logged-in.ts),
// since starting one, or planning it, is a POST. The run itself is a
// workflow's, which /api/workflows/runs/:id shows as it goes.

const job_path = z.object({ name: z.string().max(100) })

const job_request = z.object({
    // What the job takes, checked by the job itself
    input: z.unknown().optional(),
    // Only what it would change, unless this says otherwise
    dry_run: z.boolean().default(true)
})

export const jobRoutes = new Hono<ApiEnvironment>()
    // Every job: its name, what it does, and what it takes, as JSON Schema
    .get("/jobs", permitted("jobs"), (context) =>
        context.json(
            {
                jobs: JOBS.map(({ name, description, input_schema }) => ({
                    name,
                    description,
                    input: input_schema
                }))
            },
            200
        )
    )

    // A job's dry run, by default, which answers what it would change; or,
    // with `dry_run: false`, its start, which answers the run's id
    .post(
        "/jobs/:name",
        permitted("jobs"),
        validated("param", job_path),
        validated("json", job_request),
        async (context) => {
            const { name } = context.req.valid("param")
            const { input, dry_run } = context.req.valid("json")
            const job = JOBS.find((listed) => listed.name === name)
            if (job === undefined) {
                return failure(
                    context,
                    404,
                    "not-found",
                    "No job has that name"
                )
            }
            const prepared = job.prepare(input ?? {})
            if (!prepared.ok) {
                return context.json(
                    {
                        error: {
                            reason: "invalid" as const,
                            message: "That isn't what this job takes",
                            issues: prepared.error.map((issue) => ({
                                path: issue.path.join("."),
                                message: issue.message
                            }))
                        }
                    },
                    400
                )
            }
            const { user, logged_in_with } = context.var
            if (dry_run) {
                const plan = await prepared.data.plan(context.var.database)
                return context.json({ dry_run: true as const, plan }, 200)
            } else {
                const run_id = await prepared.data.start(context.var.workflows)
                console.info("Job started", {
                    job: name,
                    run_id,
                    user_id: user.id,
                    by: logged_in_with
                })
                return context.json({ dry_run: false as const, run_id }, 202)
            }
        }
    )
