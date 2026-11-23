import { pruneSessions } from "@/backend/auth/jobs"
import { APP_JOBS } from "./app"
import type { Job } from "./define"

/**
 * Every job there is, from each feature's `jobs.ts`: what
 * `GET /api/jobs` lists and `POST /api/jobs/:name` starts, whose workflows
 * WORKFLOWS registers (backend/workflows/index.ts): the template's, then
 * this app's own, which are listed in ./app.ts (`APP_JOBS`), never here.
 * One that has shipped stays until no run of it is left.
 */
export const JOBS: Job[] = [pruneSessions, ...APP_JOBS]
