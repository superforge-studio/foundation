import { MINUTE } from "@/utilities/primitives/durations"
import type {
    Infra,
    InfraProject,
    InfraUnavailable,
    InfraUsing
} from "../infra"

// Where a comment filed from the toolbar goes, which the toolbar asks
// before it shows (frontend/components/toolbar/): the board of the project
// the server's key is for, on Infra, or nowhere, and why. Only Infra itself
// keeps a comment. Its stand-in, which a dev server with no test key runs
// on, takes one as Infra would and only logs it; and with no key, a key
// Infra refuses, or an Infra that doesn't answer, none reaches it.

/** The board comments filed here go to: the key's project, in its mode. */
export type CommentBoard = {
    project: Pick<InfraProject["project"], "id" | "name">
    mode: InfraProject["mode"]
}

/**
 * Why nothing keeps a comment filed here, in words for the team: the
 * server runs on Infra's `stand-in`, or Infra is `unavailable`, with no
 * key to call it with, a key it refuses or no answer, in Infra's own
 * words or its package's.
 */
export type NoBoard = { reason: "stand-in"; message: string } | InfraUnavailable

// Why, on the stand-in
const ON_STAND_IN =
    "Nothing keeps a comment here: this dev server has no Infra test key it can use, so it runs on Infra's stand-in, which only logs each one. The project's test key, as INFRA_TEST_KEY in the checkout's .env, sends them to its board."

/**
 * Where a comment filed here goes, by which Infra the server calls
 * (`using`): nowhere on the stand-in, and otherwise to the project Infra
 * says the key is for, asked once and remembered.
 */
export async function findBoard(
    infra: Infra,
    using: InfraUsing
): AsyncOperationResult<CommentBoard, NoBoard> {
    if (using === "stand-in") {
        return {
            ok: false,
            error: { reason: "stand-in", message: ON_STAND_IN }
        }
    }
    const known = await projectOf(infra)
    if (!known.ok) {
        return known
    }
    const { project, mode } = known.data
    return {
        ok: true,
        data: { project: { id: project.id, name: project.name }, mode }
    }
}

// What an Infra said when asked which project its key is for, and when
// that was a failure
type Said = {
    answer: ReturnType<Infra["project"]>
    failed_at: number | null
}

// What each Infra said, by the Infra, so each test's API has its own: the
// project, kept for the life of the server, since its key only changes
// with a restart; or why not, kept a minute, so an Infra that comes back
// up is asked again soon. A request that comes while Infra's being asked
// waits for the same answer.
const SAID = new WeakMap<Infra, Said>()

// How long a failure is kept before Infra is asked again
const FAILURE_KEPT_FOR = MINUTE

// Which project the key is for, as Infra last said (GET /v1/project)
async function projectOf(infra: Infra) {
    const said = SAID.get(infra)
    if (
        said !== undefined &&
        (said.failed_at === null ||
            Date.now() - said.failed_at < FAILURE_KEPT_FOR)
    ) {
        return await said.answer
    }
    const asking: Said = { answer: infra.project(), failed_at: null }
    SAID.set(infra, asking)
    const answer = await asking.answer
    if (!answer.ok) {
        asking.failed_at = Date.now()
    }
    return answer
}
