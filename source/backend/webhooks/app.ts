import type { WebhookSource } from "./sources"

/**
 * This app's own sources: the services that post the app webhooks, each
 * at /api/webhooks/<name>. None, as the template ships. A copy adds one
 * the day it wires up a service, in a file of its own beside this one
 * (stripe.ts), with its secret in a Railway variable (README.md, "Adding a
 * source"), and lists it here, where no update from the template meets it:
 *
 *   import { stripe } from "./stripe"
 *
 *   export const APP_SOURCES: WebhookSource[] = [stripe]
 */
export const APP_SOURCES: WebhookSource[] = []
