import { z } from "zod"

// What logging in takes, checked the same by the login form before it
// sends and by the routes under /api/auth (backend/auth/routes.ts), which
// check it again whatever the form said. Infra checks an address and a code
// the same way.

/** An email address as the app keeps it: trimmed, lowercased and checked. */
export const email_address = z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email().max(254))

/**
 * A login email's code, forgiving the spaces a pasted code can carry
 * (`123 456`): digits, six as Infra sends them today, taken from 4 to 12
 * so Infra, which checks it, is the one to say no.
 */
export const login_code = z
    .string()
    .transform((value) => value.replace(/\s/g, ""))
    .pipe(z.string().regex(/^\d{4,12}$/))

/**
 * A login link's token: what follows `#` in the link the email holds
 * (`/login#<token>`), base64url, 43 characters as Infra makes them today,
 * taken from 20 to 200 so Infra, which checks it, is the one to say no.
 */
export const login_token = z.string().regex(/^[\w-]{20,200}$/)

/** What starts a login: the address to email a code and a link to. */
export const login_start = z.object({ email: email_address })

/**
 * What finishes one: the code the visitor typed, with the address it went
 * to, or the token from the link they opened.
 */
export const login_verify = z.union([
    z.object({ email: email_address, code: login_code }),
    z.object({ token: login_token })
])
export type LoginProof = z.infer<typeof login_verify>
