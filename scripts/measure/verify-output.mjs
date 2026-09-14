// Parses the post-apply verification lines `init-engine.mjs`'s
// `reportVerification` already prints (`  - <label>: OK` / `FAILED`) out of a
// scenario's captured CLI stdout. Deliberately does not modify
// `scripts/lib/verify.mjs`/`init-engine.mjs` to expose structured results —
// this reuses the exact stdout contract `scripts/init-project.test.mjs`
// already asserts against (e.g. `/typecheck: OK/`), so it tracks real CLI
// behavior instead of adding a second, parallel notion of "what verification
// ran."
const STAGE_LABELS = ['typecheck', 'lint', 'web build', 'api test', 'web test']

/**
 * Returns one `{ label, ok }` entry per verification stage line found in
 * `stdout`, in the order `verify.mjs` runs them. A label absent from
 * `stdout` did not run for this scenario (e.g. Storybook-disabled runs skip
 * verification entirely — `init-project.mjs`'s own `defaultVerify` is
 * `() => []` for that dimension, not a parsing gap here).
 */
export function parseVerificationStages(stdout) {
  const results = []
  for (const label of STAGE_LABELS) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = stdout.match(new RegExp(`- ${escaped}: (OK|FAILED)`))
    if (match) results.push({ label, ok: match[1] === 'OK' })
  }
  return results
}

/** Reduces parsed verification stages into the counters §B of PR1's report requires. */
export function summarizeVerificationCounters(stages) {
  const ran = (label) => stages.some((stage) => stage.label === label)
  return {
    typecheckRuns: ran('typecheck') ? 1 : 0,
    lintRuns: ran('lint') ? 1 : 0,
    buildRuns: ran('web build') ? 1 : 0,
    testRuns: stages.filter((stage) => stage.label === 'api test' || stage.label === 'web test')
      .length,
  }
}
