// Runs one scenario from scenario-registry.mjs against a fresh disposable
// repo copy, instrumenting counters/stage timing/disk usage (BACKLOG item
// 14, PR1 §B). Reuses the existing test harness (`createRealRepoCopy`,
// `commit`, `installDependencies`, `runInitProject`) unmodified — this file
// only wraps it with measurement. Opt-in: nothing here runs unless a caller
// explicitly calls `runInstrumentedScenario`.
import { createRealRepoCopy, installDependencies } from '../lib/test-fixture.mjs'
import { commit, runInitProject } from '../lib/init-project-test-helpers.mjs'
import { withPeakDiskSampling } from './fs-usage.mjs'
import { parseVerificationStages, summarizeVerificationCounters } from './verify-output.mjs'
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

function runInstallStage(state, scenario, root, label) {
  const start = performance.now()
  installDependencies(root)
  state.counters.installs += 1
  record(state, scenario.name, { label, ok: true, durationMs: performance.now() - start, ranAt: new Date().toISOString() })
}

function runApplyStage(state, scenario, root) {
  const start = performance.now()
  const result = runInitProject(root, scenario.flags, { skipVerify: scenario.skipVerify })
  const ok = result.status === 0
  record(state, scenario.name, {
    label: 'apply',
    ok,
    durationMs: performance.now() - start,
    ranAt: new Date().toISOString(),
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  })
  if (ok) Object.assign(state.counters, summarizeVerificationCounters(parseVerificationStages(result.stdout ?? '')))
}

function runPostApplySteps(state, scenario, root) {
  for (const args of scenario.postApplySteps ?? []) {
    if (state.failedStage) break
    const stage = runPnpm(root, args)
    if (record(state, scenario.name, stage)) {
      const bucket = bucketFor(args)
      if (bucket) state.counters[bucket] += 1
    }
  }
}

async function execute(scenario, root) {
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
