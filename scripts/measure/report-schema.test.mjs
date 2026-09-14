import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { SCHEMA_VERSION, validateReport } from './report-schema.mjs'

function validScenario(overrides = {}) {
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
    counters: { repoCopies: 1 },
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

function validReport(overrides = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    environment: 'local',
    nodeVersion: process.version,
    pnpmVersion: '11.1.2',
    scenarios: [validScenario()],
    transformInventory: [],
    topology: { candidateEquivalentGroups: [] },
    ...overrides,
  }
}

describe('report-schema', () => {
  test('accepts a well-formed report', () => {
    const { valid, errors } = validateReport(validReport())
    assert.equal(valid, true, errors.join('; '))
  })

  test('rejects a report missing a top-level field, naming it', () => {
    const report = validReport()
    delete report.environment
    const { valid, errors } = validateReport(report)
    assert.equal(valid, false)
    assert.ok(errors.some((e) => e.includes('environment')))
  })

  test('rejects a scenario missing a field, naming its index and field', () => {
    const report = validReport({ scenarios: [validScenario(), validScenario({ wallTimeMs: undefined })] })
    const { valid, errors } = validateReport(report)
    assert.equal(valid, false)
    assert.ok(errors.some((e) => e.includes('scenarios[1]') && e.includes('wallTimeMs')))
  })

  test('rejects a mismatched schemaVersion instead of silently comparing', () => {
    const { valid, errors } = validateReport(validReport({ schemaVersion: '0.0.1' }))
    assert.equal(valid, false)
    assert.ok(errors[0].includes('schemaVersion'))
  })

  test('rejects a non-object', () => {
    const { valid, errors } = validateReport(null)
    assert.equal(valid, false)
    assert.ok(errors.length > 0)
  })
})
