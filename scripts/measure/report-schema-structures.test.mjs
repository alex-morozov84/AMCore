import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { validateReport } from './report-schema.mjs'
import {
  validCounters,
  validReport,
  validScenario,
  validTransformInventoryItem,
} from './report-schema-test-fixtures.mjs'

describe('report-schema structured fields', () => {
  test('rejects missing, negative, or non-integer counters', () => {
    const incomplete = { ...validCounters() }
    delete incomplete.installs
    assert.equal(
      validateReport(validReport({ scenarios: [validScenario({ counters: incomplete })] })).valid,
      false
    )
    for (const bad of [-1, 1.5, '1', null]) {
      const report = validReport({
        scenarios: [validScenario({ counters: validCounters({ installs: bad }) })],
      })
      assert.equal(validateReport(report).valid, false, `installs=${JSON.stringify(bad)}`)
    }
  })

  test('rejects a non-string flag', () => {
    const report = validReport({ scenarios: [validScenario({ flags: ['--yes', 42] })] })
    assert.equal(validateReport(report).valid, false)
  })

  test('validates fingerprint structure', () => {
    const incomplete = validReport({
      scenarios: [validScenario({ fingerprint: { treeHash: 'abc' } })],
    })
    assert.equal(validateReport(incomplete).valid, false)
    const fingerprint = {
      treeHash: 'abc',
      fileCount: 10,
      significantValues: { i18n_mode: 'multi' },
    }
    assert.equal(
      validateReport(validReport({ scenarios: [validScenario({ fingerprint })] })).valid,
      true
    )
  })

  test('validates transform inventory items and histograms', () => {
    const missing = validReport({
      transformInventory: [validTransformInventoryItem({ domain: undefined })],
    })
    const result = validateReport(missing)
    assert.equal(result.valid, false)
    assert.ok(result.errors.some((error) => error.includes('transformInventory[0]')))
    const zero = validReport({
      transformInventory: [validTransformInventoryItem({ histogram: { delete: 0 } })],
    })
    assert.equal(validateReport(zero).valid, false)
  })

  test('candidate topology groups require at least two names', () => {
    const singleton = validReport({ topology: { candidateEquivalentGroups: [['only-one']] } })
    assert.equal(validateReport(singleton).valid, false)
    const pair = validReport({ topology: { candidateEquivalentGroups: [['a', 'b']] } })
    assert.equal(validateReport(pair).valid, true)
  })

  test('rejects a malformed operation-level inventory item', () => {
    const operationInventory = { operations: [{ scenarioName: 'demo' }], exactCopyEdges: [] }
    const result = validateReport(validReport({ operationInventory }))
    assert.equal(result.valid, false)
    assert.ok(result.errors.some((error) => error.includes('operationInventory.operations[0]')))
  })

  test('validates optional migration unit counts', () => {
    const migrationCounts = {
      legacyOperations: 346,
      semanticFacts: 34,
      semanticClaims: 116,
      sharedContentOperations: 32,
      materializedFilesystemOperations: 366,
    }
    const valid = validReport({
      operationInventory: { operations: [], exactCopyEdges: [], migrationCounts },
    })
    assert.equal(validateReport(valid).valid, true)
    const malformed = validReport({
      operationInventory: {
        operations: [],
        exactCopyEdges: [],
        migrationCounts: { ...migrationCounts, semanticClaims: -1 },
      },
    })
    assert.equal(validateReport(malformed).valid, false)
  })
})
