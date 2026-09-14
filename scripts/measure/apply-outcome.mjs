// Pure derivation of counters/stage records from one raw CLI apply result —
// split out of instrumented-run.mjs to stay under the repo's line-count
// guidance, and because "no subprocess, synthetic {status,stdout} in" is
// exactly what makes this directly unit-testable (BACKLOG item 14, PR1
// Round 8 correction: partial internal verification evidence was
// previously discarded whenever the CLI's overall exit was non-zero).
import { parseVerificationStages, summarizeVerificationCounters } from './verify-output.mjs'

/**
 * `result.stdout` may contain real `reportVerification` output (one printed
 * line per completed stage) even when the CLI's overall exit is non-zero —
 * an early typecheck/lint success followed by a later failed test would
 * otherwise be discarded entirely, so parsing always happens, never gated on
 * `ok`. The `apply` stage still reports only *aggregate* wall time for the
 * whole CLI invocation — per-internal-substep timing is not observable
 * without instrumenting scripts/lib/verify.mjs itself, which PR1's gate
 * forbids touching; when an internal stage failed, its own label (not the
 * generic "apply") becomes the diagnostic-bearing failed stage, so the
 * record names the real cause.
 */
export function deriveApplyOutcome(result, durationMs, ranAt) {
  const ok = result.status === 0
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  const parsedStages = parseVerificationStages(result.stdout ?? '')
  const counters = summarizeVerificationCounters(parsedStages)
  const failedInternalStage = parsedStages.find((stage) => !stage.ok)

  if (ok || !failedInternalStage) {
    return { counters, applyStage: { label: 'apply', ok, durationMs, ranAt, output }, failedInternalStage: null }
  }
  return {
    counters,
    applyStage: { label: 'apply', ok: false, durationMs, ranAt, output: '' },
    failedInternalStage: { label: failedInternalStage.label, ok: false, durationMs: 0, ranAt, output },
  }
}
