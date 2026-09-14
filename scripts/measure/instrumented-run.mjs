// Runs one scenario from scenario-registry.mjs against a fresh disposable
// repo copy, instrumenting counters/stage timing/disk usage (BACKLOG item
// 14, PR1 §B). Reuses the existing test harness (`createRealRepoCopy`,
// `commit`, `installDependencies`, `runInitProject`) unmodified — this file
// only wraps it with measurement. Opt-in: nothing here runs unless a caller
// explicitly calls `runInstrumentedScenario`.
import { createRealRepoCopy, installDependencies } from '../lib/test-fixture.mjs'
import { commit, runInitProject } from '../lib/init-project-test-helpers.mjs'
import { withPeakDiskSampling } from './fs-usage.mjs'
import { deriveApplyOutcome } from './apply-outcome.mjs'
import { stampScenario, classifyComparability } from './provenance.mjs'
import { fingerprintTree } from './fingerprint.mjs'
import { runPnpm, saveDiagnostics, bucketFor } from './pnpm-stage.mjs'

function makeState() {
  return {
    stages: [],
    counters: { repoCopies: 1, installs: 0, typecheckRuns: 0, lintRuns: 0, buildRuns: 0, testRuns: 0 },
    failedStage: null,
    diagnosticsPath: null,
  }
}

/** Records one finished stage, capturing diagnostics for the first failure only. Returns `stage.ok`. */
function record(state, scenarioName, stage) {
  state.stages.push({ label: stage.label, ranAt: stage.ranAt, ok: stage.ok, durationMs: stage.durationMs })
  if (!stage.ok && !state.failedStage) {
    state.failedStage = stage.label
    state.diagnosticsPath = saveDiagnostics(scenarioName, stage)
  }
  return stage.ok
}

/**
 * Runs `installDependencies` as an ordinary, recorded stage instead of an
 * uncaught throw. `installDependencies` is `execFileSync`-based and throws
 * on a non-zero `pnpm install` exit; a real install failure must produce a
 * failed-scenario record with diagnostics, not abort the whole report
 * (BACKLOG item 14, PR1 Round 8 correction).
 */
function runInstallStage(state, scenario, root, label) {
  const start = performance.now()
  // Counted on attempt, not only on success — the install genuinely ran.
  state.counters.installs += 1
  let ok = true
  let output = ''
  try {
    installDependencies(root)
  } catch (error) {
    ok = false
    output = `${error.stdout ?? ''}${error.stderr ?? ''}` || (error.message ?? String(error))
  }
  record(state, scenario.name, { label, ok, durationMs: performance.now() - start, ranAt: new Date().toISOString(), output })
}

function runApplyStage(state, scenario, root) {
  const start = performance.now()
  const result = runInitProject(root, scenario.flags, { skipVerify: scenario.skipVerify })
  const { counters, applyStage, failedInternalStage } = deriveApplyOutcome(
    result,
    performance.now() - start,
    new Date().toISOString()
  )
  Object.assign(state.counters, counters)
  if (failedInternalStage) {
    state.stages.push(applyStage)
    record(state, scenario.name, failedInternalStage)
  } else {
    record(state, scenario.name, applyStage)
  }
}

function runPostApplySteps(state, scenario, root) {
  for (const args of scenario.postApplySteps ?? []) {
    if (state.failedStage) break
    const stage = runPnpm(root, args)
    // Counted on run, not only on success — the (possibly expensive) command
    // did execute even if it then failed.
    const bucket = bucketFor(args)
    if (bucket) state.counters[bucket] += 1
    record(state, scenario.name, stage)
  }
}

/** Exported for direct testing without a real disposable-copy/full-scenario round trip. */
export async function execute(scenario, root) {
  const state = makeState()
  if (scenario.installBefore) runInstallStage(state, scenario, root, 'install')
  if (!state.failedStage) runApplyStage(state, scenario, root)
  if (!state.failedStage && scenario.installAfter) {
    runInstallStage(state, scenario, root, 'install (post-apply)')
  }
  runPostApplySteps(state, scenario, root)
  return {
    stages: state.stages,
    counters: state.counters,
    success: !state.failedStage,
    failedStage: state.failedStage,
    diagnosticsPath: state.diagnosticsPath,
  }
}

/** Runs one scenario end-to-end, returning a full report record (see report-schema.mjs SCENARIO_SHAPE). */
export async function runInstrumentedScenario(scenario, runProvenance) {
  const copy = createRealRepoCopy()
  try {
    commit(copy.root)
    const wallStart = performance.now()
    const sampled = await withPeakDiskSampling(copy.root, 2000, () => execute(scenario, copy.root))
    const { result: outcome, peakDiskUsageBytes, finalDiskUsageBytes } = sampled
    // A failed scenario's tree isn't a valid generated topology to fingerprint.
    const fingerprint = outcome.success ? fingerprintTree(copy.root) : null
    const comparability = classifyComparability(runProvenance)
    return {
      ...stampScenario(runProvenance, scenario.name),
      flags: scenario.flags,
      comparable: comparability.comparable,
      comparabilityReason: comparability.reason,
      counters: outcome.counters,
      stages: outcome.stages,
      wallTimeMs: performance.now() - wallStart,
      peakDiskUsageBytes,
      finalDiskUsageBytes,
      success: outcome.success,
      failedStage: outcome.failedStage,
      diagnosticsPath: outcome.diagnosticsPath,
      fingerprint,
    }
  } finally {
    copy.cleanup()
  }
}
