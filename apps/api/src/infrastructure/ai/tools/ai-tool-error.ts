/**
 * Explicit "this tool call produced NO external effect" signals (Track C — ADR-054, E12 contract). A tool
 * that throws anything else — or times out — leaves its effect UNKNOWN when it is side-effecting:
 * a local exception can follow a remote success, and a timeout says nothing about the remote side.
 *
 * Outcomes of one tool execution (the full contract):
 * - `succeeded` — it returned a result;
 * - `rejected-no-effect` — it refused the call with certainty that nothing happened (`AiToolRejectedError`);
 * - `retryable-no-effect` — it failed with certainty that nothing happened and a later retry is
 *   reasonable (`AiToolRetryableError`; recorded now, retry mechanics are a later extension);
 * - `effect-unknown` — anything else for a side-effecting tool: the run stops uncertain and nothing is
 *   re-executed or re-requested.
 */
export type AiToolNoEffectOutcome = 'rejected_no_effect' | 'retryable_no_effect'

/** Base of the two explicit no-effect errors. Throw only when the tool is CERTAIN nothing happened. */
export abstract class AiToolNoEffectError extends Error {
  abstract readonly outcome: AiToolNoEffectOutcome

  constructor(message = 'AI tool failed with no external effect') {
    super(message)
    this.name = new.target.name
  }
}

/** The tool rejected the call before doing anything (invalid state, permission denied, …). */
export class AiToolRejectedError extends AiToolNoEffectError {
  readonly outcome = 'rejected_no_effect' as const
}

/** The tool failed before doing anything and a later retry is reasonable. */
export class AiToolRetryableError extends AiToolNoEffectError {
  readonly outcome = 'retryable_no_effect' as const
}
