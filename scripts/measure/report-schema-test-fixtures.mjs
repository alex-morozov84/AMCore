import { SCHEMA_VERSION } from './report-schema.mjs'

export function validCounters(overrides = {}) {
  return {
    repoCopies: 1,
    installs: 1,
    typecheckRuns: 1,
    lintRuns: 1,
    buildRuns: 1,
    testRuns: 2,
    ...overrides,
  }
}

export function validScenario(overrides = {}) {
  return {
    scenarioName: 'demo',
    flags: ['--yes'],
    startedAt: new Date().toISOString(),
    repoSha: 'a'.repeat(40),
    repoDirty: false,
    fixtureSha: 'a'.repeat(40),
    cliSha: 'a'.repeat(40),
    comparable: true,
    comparabilityReason: null,
    counters: validCounters(),
    stages: [{ label: 'apply', ranAt: new Date().toISOString(), ok: true, durationMs: 12 }],
    wallTimeMs: 12,
    peakDiskUsageBytes: 1024,
    finalDiskUsageBytes: 1024,
    success: true,
    failedStage: null,
    diagnosticsPath: null,
    fingerprint: null,
    ...overrides,
  }
}

export function validTransformInventoryItem(overrides = {}) {
  return {
    modulePath: 'scripts/lib/project-plan-demo.mjs',
    dimension: 'demo',
    histogram: { delete: 1 },
    primaryShape: 'delete',
    unclassifiedReason: null,
    domain: { docs: false, tests: false, ci: false, proxy: false },
    ...overrides,
  }
}

export function validReport(overrides = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    environment: 'local',
    nodeVersion: process.version,
    pnpmVersion: '11.1.2',
    scenarios: [validScenario()],
    transformInventory: [validTransformInventoryItem()],
    operationInventory: { operations: [], exactCopyEdges: [] },
    topology: { candidateEquivalentGroups: [] },
    ...overrides,
  }
}
