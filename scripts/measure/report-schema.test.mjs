import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { validateReport } from './report-schema.mjs'
import { validReport, validScenario } from './report-schema-test-fixtures.mjs'

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
    const report = validReport({
      scenarios: [validScenario(), validScenario({ wallTimeMs: undefined })],
    })
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
