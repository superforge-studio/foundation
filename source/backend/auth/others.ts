import type { Context } from "hono"
import type { ApiEnvironment } from "../context"
import { failure } from "../failures"

// Who else logs in, besides the team. As the template ships, no one does
// (`NO_ONE_ELSE`): ./app.ts lists the team, and an address it doesn't have
// is refused. An app whose customers or members log in too gives a second
// kind of person a way in, in ./app.ts (`OTHERS`), from a feature of its
// own, with a table of its own for their sessions, never `auth.sessions`,
// which is the team's.
//
// The team always comes first: an address ./app.ts lists logs in as one of
// the team, and only one it doesn't have is asked of these. They share the
// login page, the code and the link Infra emails, and the `session` cookie
// (logged-in.ts), whose token is looked for among the team's sessions
// first. So `loggedIn` and `permitted` never let one of them through: a
// route of theirs takes a check of its feature's own, which reads the same
// cookie.

/** What the template's login routes (./routes.ts) ask of whoever else logs in. */
export type OtherLogins<Refused, LoggedIn, Session> = {
    /**
     * Whether `email`, which isn't one of the team's, may start logging in,
     * before Infra is asked to email it.
     */
    mayLogIn<Environment extends ApiEnvironment>(
        context: Context<Environment>,
        email: string
    ): Promise<boolean>
    /**
     * Answers `/api/auth/verify` for `email`, which isn't one of the team's,
     * once Infra has said it's theirs: ends whatever session this browser
     * had, the team's or one of theirs (`sessionToken`, `endSession`),
     * starts theirs, sets its cookie (`setSessionCookie`), and answers who
     * they are, or refuses.
     */
    logIn<Environment extends ApiEnvironment>(
        context: Context<Environment>,
        email: string
    ): Promise<Refused | LoggedIn>
    /**
     * What `/api/auth/session` says beside `user` and `permissions`, like
     * `{ customer }`: whoever of theirs this browser's session is, or
     * nobody, as it always is while one of the team is logged in.
     */
    session<Environment extends ApiEnvironment>(
        context: Context<Environment>
    ): Promise<Session>
    /** Ends the session behind `token`, if it's one of theirs. */
    logOut<Environment extends ApiEnvironment>(
        context: Context<Environment>,
        token: string
    ): Promise<void>
}

/**
 * Names a kind of person who logs in besides the team, keeping what each
 * part answers, so the typed client knows it.
 */
export function otherLogins<Refused, LoggedIn, Session>(
    logins: OtherLogins<Refused, LoggedIn, Session>
) {
    return logins
}

/** What someone hears when nothing lets their address in */
export const NOT_LISTED =
    "This address can't log in here. Ask whoever runs this app to add you to the team."

/** No one else logs in: the template's, where the team is everyone there is. */
export const NO_ONE_ELSE = otherLogins({
    mayLogIn: async () => false,
    logIn: async (context) => failure(context, 403, "not-listed", NOT_LISTED),
    session: async () => ({}),
    logOut: async () => {}
})
