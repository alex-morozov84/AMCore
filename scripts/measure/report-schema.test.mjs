import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { SCHEMA_VERSION, validateReport } from './report-schema.mjs'

function validCounters(overrides = {}) {
  return { repoCopies: 1, installs: 1, typecheckRuns: 1, lintRuns: 1, buildRuns: 1, testRuns: 2, ...overrides }
}

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

function validTransformInventoryItem(overrides = {}) {
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

function validReport(overrides = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    environment: 'local',
    nodeVersion: process.version,
    pnpmVersion: '11.1.2',
    scenarios: [validScenario()],
    transformInventory: [validTransformInventoryItem()],
    topology: { candidateEquivalentGroups: [] },
    ...overrides,
  }
}

describe('report-schema: basic shape', () => {
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

describe('report-schema: strengthened field validation (Round 8 correction)', () => {
  test('rejects counters missing a required named field', () => {
    const incomplete = { ...validCounters() }
    delete incomplete.installs
    const { valid, errors } = validateReport(validReport({ scenarios: [validScenario({ counters: incomplete })] }))
    assert.equal(valid, false)
    assert.ok(errors.some((e) => e.includes('counters')))
  })

  test('rejects a negative or non-integer counter value', () => {
    for (const bad of [-1, 1.5, '1', null]) {
      const { valid } = validateReport(
        validReport({ scenarios: [validScenario({ counters: validCounters({ installs: bad }) })] })
      )
      assert.equal(valid, false, `installs=${JSON.stringify(bad)} should be rejected`)
    }
  })

  test('rejects a flags array containing a non-string element', () => {
    const { valid, errors } = validateReport(validReport({ scenarios: [validScenario({ flags: ['--yes', 42] })] }))
    assert.equal(valid, false)
    assert.ok(errors.some((e) => e.includes('flags')))
  })

  test('rejects a fingerprint missing fileCount or significantValues', () => {
    const { valid } = validateReport(
      validReport({ scenarios: [validScenario({ fingerprint: { treeHash: 'abc' } })] })
    )
    assert.equal(valid, false)
  })

  test('accepts a well-formed fingerprint', () => {
    const { valid, errors } = validateReport(
      validReport({
        scenarios: [
          validScenario({
            fingerprint: { treeHash: 'abc', fileCount: 10, significantValues: { i18n_mode: 'multi' } },
          }),
        ],
      })
    )
    assert.equal(valid, true, errors.join('; '))
  })

  test('rejects a transform-inventory item missing a required field, naming its index', () => {
    const { valid, errors } = validateReport(
      validReport({ transformInventory: [validTransformInventoryItem({ domain: undefined })] })
    )
    assert.equal(valid, false)
    assert.ok(errors.some((e) => e.includes('transformInventory[0]') && e.includes('domain')))
  })

  test('rejects a histogram with a zero or non-integer count', () => {
    const { valid } = validateReport(
      validReport({ transformInventory: [validTransformInventoryItem({ histogram: { delete: 0 } })] })
    )
    assert.equal(valid, false)
  })

  test('rejects a topology candidate group with fewer than 2 members', () => {
    const { valid } = validateReport(validReport({ topology: { candidateEquivalentGroups: [['only-one']] } }))
    assert.equal(valid, false)
  })

  test('accepts a well-formed topology candidate group', () => {
    const { valid, errors } = validateReport(
      validReport({ topology: { candidateEquivalentGroups: [['a', 'b']] } })
    )
    assert.equal(valid, true, errors.join('; '))
  })
})
