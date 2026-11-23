// Types every file can use without importing them. This file has no import
// or export, which is what makes what it declares global: one import here
// and they stop being. Types only, since nothing here exists at runtime;
// keep it to the few types nearly every file needs
// (workbench/writing-code.md, "Tagged results for expected failures").

/**
 * What a function that can fail in an expected, recoverable way returns.
 * `throw` stays reserved for the genuinely unexpected (bugs, unreachable
 * states, infrastructure), so a caller holding one of these knows the
 * failure is one it's meant to handle. `Err` is required, not defaulted to
 * `string`: naming the failure is the point, as a literal union when the
 * outcome is the whole story, or a structured object when it carries
 * context. (`Err`, not `Error`, so it doesn't shadow the global class.)
 */
type OperationResult<Data, Err> =
    | { ok: true; data: Data }
    | { ok: false; error: Err }

/**
 * The async form of `OperationResult`, for functions that are async.
 * `@superforge/infra` exports the same two types, the same shape, so its
 * results and the app's are one and the same to TypeScript.
 */
type AsyncOperationResult<Data, Err> = Promise<OperationResult<Data, Err>>
