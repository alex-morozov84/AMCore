import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { renderHumanSummary } from './baseline-report.mjs'
import { SCHEMA_VERSION } from './report-schema.mjs'

function fakeReport(overrides = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: '2026-09-14T00:00:00.000Z',
    environment: 'local',
    nodeVersion: 'v24.18.0',
    pnpmVersion: '11.1.2',
    comparability: { comparable: true, reason: null },
    scenarios: [
      {
        scenarioName: 'demo',
        success: true,
        failedStage: null,
        wallTimeMs: 1234,
        peakDiskUsageBytes: 2_000_000,
        counters: { installs: 1 },
      },
    ],
    transformInventory: [
      { primaryShape: 'whole-file-legacy-before-after' },
      { primaryShape: 'whole-file-legacy-before-after' },
      { primaryShape: 'structured-config' },
    ],
    operationInventory: { operations: [], exactCopyEdges: [] },
    topology: { candidateEquivalentGroups: [] },
    ...overrides,
  }
}

describe('renderHumanSummary', () => {
  test('includes schema version, comparability, and each scenario status', () => {
    const text = renderHumanSummary(fakeReport())
    assert.match(text, new RegExp(`schema ${SCHEMA_VERSION}`))
    assert.match(text, /Comparable revision: yes/)
    assert.match(text, /demo: OK, 1234ms, 1 install\(s\), peak disk 2\.0MB/)
  })

  test('surfaces a non-comparable reason instead of hiding it', () => {
    const text = renderHumanSummary(
      fakeReport({ comparability: { comparable: false, reason: 'dirty tree' } })
    )
    assert.match(text, /Comparable revision: NO — dirty tree/)
  })

  test('reports a failed scenario by its failed stage, not just "not OK"', () => {
    const report = fakeReport()
    report.scenarios[0].success = false
    report.scenarios[0].failedStage = 'install'
    const text = renderHumanSummary(report)
    assert.match(text, /demo: FAILED at "install"/)
  })

  test('aggregates transform-shape counts deterministically (sorted)', () => {
    const text = renderHumanSummary(fakeReport())
    const lines = text.split('\n')
    const shapeIndex = lines.findIndex((l) => l.includes('Transform inventory'))
    assert.match(lines[shapeIndex + 1], /structured-config: 1/)
    assert.match(lines[shapeIndex + 2], /whole-file-legacy-before-after: 2/)
  })

  test('lists candidate equivalent groups when present, labeled as not automatic', () => {
    const text = renderHumanSummary(
      fakeReport({ topology: { candidateEquivalentGroups: [['a', 'b']] } })
    )
    assert.match(text, /not acted on automatically/)
    assert.match(text, /- a, b/)
  })

  test('never includes an absolute filesystem path from this machine', () => {
    const text = renderHumanSummary(fakeReport())
    assert.doesNotMatch(text, /\/Users\/|\/private\/|\/home\//)
  })
})
