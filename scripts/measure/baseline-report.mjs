// Assembles one scaffolding baseline report (BACKLOG item 14, PR1 §F):
// provenance + per-scenario measurements + static transform inventory +
// candidate topology equivalence — and renders a short human summary.
// Deterministic: scenario/inventory/group ordering never depends on
// execution order or object-key insertion order.
import { SCHEMA_VERSION, validateReport } from './report-schema.mjs'
import { collectRunProvenance, classifyComparability } from './provenance.mjs'
import { SCENARIOS } from './scenario-registry.mjs'
import { runInstrumentedScenario } from './instrumented-run.mjs'
import { buildTransformInventory } from './transform-inventory.mjs'
import { groupCandidateEquivalents } from './fingerprint.mjs'

async function runScenarios(scenarios, runProvenance, onProgress) {
  const results = []
  for (const scenario of scenarios) {
    onProgress?.(scenario.name)
    results.push(await runInstrumentedScenario(scenario, runProvenance))
  }
  return results.sort((a, b) => a.scenarioName.localeCompare(b.scenarioName))
}

/**
 * Runs every (or `scenarioFilter`-selected) registered scenario and builds
 * the full report object. `onProgress(name)` fires before each scenario
 * starts — baseline runs are slow (real installs/builds), so a caller
 * should surface this rather than go silent for minutes.
 */
export async function buildBaselineReport({ scenarioFilter, onProgress } = {}) {
  const runProvenance = collectRunProvenance()
  const comparability = classifyComparability(runProvenance)
  const scenarios = await runScenarios(
    scenarioFilter ? SCENARIOS.filter(scenarioFilter) : SCENARIOS,
    runProvenance,
    onProgress
  )

  const equivalentGroups = groupCandidateEquivalents(
    scenarios
      .filter((s) => s.fingerprint)
      .map((s) => ({ scenarioName: s.scenarioName, treeHash: s.fingerprint.treeHash }))
  ).map((group) => [...group].sort())

  const report = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    environment: runProvenance.environment,
    nodeVersion: runProvenance.nodeVersion,
    pnpmVersion: runProvenance.pnpmVersion,
    runProvenance,
    comparability,
    scenarios,
    transformInventory: buildTransformInventory(),
    topology: { candidateEquivalentGroups: equivalentGroups },
  }
  const { valid, errors } = validateReport(report)
  if (!valid) throw new Error(`built an invalid baseline report: ${errors.join('; ')}`)
  return report
}

function shapeCounts(inventory) {
  const counts = {}
  for (const module of inventory) counts[module.primaryShape] = (counts[module.primaryShape] ?? 0) + 1
  return Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))
}

/** Renders a short, human-readable summary of a report built by {@link buildBaselineReport}. */
export function renderHumanSummary(report) {
  const lines = [
    `Scaffolding baseline report (schema ${report.schemaVersion})`,
    `Generated ${report.generatedAt} | ${report.environment} | node ${report.nodeVersion} | pnpm ${report.pnpmVersion}`,
    `Comparable revision: ${report.comparability.comparable ? 'yes' : `NO — ${report.comparability.reason}`}`,
    '',
    'Scenarios:',
  ]
  for (const s of report.scenarios) {
    const status = s.success ? 'OK' : `FAILED at "${s.failedStage}"`
    const diskMb = (s.peakDiskUsageBytes / 1e6).toFixed(1)
    lines.push(`  - ${s.scenarioName}: ${status}, ${Math.round(s.wallTimeMs)}ms, ${s.counters.installs} install(s), peak disk ${diskMb}MB`)
  }
  lines.push('', `Transform inventory: ${report.transformInventory.length} modules`)
  for (const [shape, count] of shapeCounts(report.transformInventory)) lines.push(`  - ${shape}: ${count}`)
  if (report.topology.candidateEquivalentGroups.length > 0) {
    lines.push('', 'Candidate equivalent topology groups (not acted on automatically):')
    for (const group of report.topology.candidateEquivalentGroups) lines.push(`  - ${group.join(', ')}`)
  }
  return lines.join('\n')
}
