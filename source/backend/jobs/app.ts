import type { Job } from "./define"

/**
 * This app's own jobs, listed after the template's (./index.ts), from each
 * of its features' `jobs.ts`. A new one goes here the moment it's defined,
 * and one that has shipped stays until no run of it is left. They're here,
 * apart from the template's, so an update from the template never meets
 * them.
 */
export const APP_JOBS: Job[] = []
