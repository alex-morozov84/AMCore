import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { buildFallback } from '../scaffold-selector/output.mjs'
import { validateDecision } from '../scaffold-selector/output-schema.mjs'

function runReport(decisionPath, artifactPath, summaryPath) {
  execFileSync('node', [
    'scripts/scaffold-selector/report.mjs',
    '--decision',
    decisionPath,
    '--artifact',
    artifactPath,
    '--summary',
    summaryPath,
    '--run-id',
    '42',
    '--run-attempt',
    '1',
    '--outcome',
    'success',
  ])
}

const expectedObservation = {
  runId: '42',
  runAttempt: '1',
  wouldRun: true,
  actuallyRan: true,
  generatedStepOutcome: 'success',
  selectorTrustSource: 'merge-base',
  selectorDegraded: true,
}

test('versioned output rejects missing, unknown, and wrong-mode data', () => {
  const decision = buildFallback({ reason: 'selector_error', detail: 'probe' })
  assert.equal(validateDecision(decision), decision)
  assert.throws(() => validateDecision({ ...decision, surprise: true }), /unknown/u)
  assert.throws(() => validateDecision({ ...decision, mode: 'skip' }), /version or mode/u)
  const { lanes, ...missing } = decision
  assert.throws(() => validateDecision(missing), /missing/u)
  void lanes
})

test('shadow report records execution and sanitizes bounded Markdown', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'amcore-selector-report-'))
  try {
    const decisionPath = path.join(root, 'decision.json')
    const artifactPath = path.join(root, 'artifact.json')
    const summaryPath = path.join(root, 'summary.md')
    const decision = buildFallback({ reason: 'trusted_selector_missing', detail: 'bad|`<name>' })
    writeFileSync(decisionPath, JSON.stringify(decision))
    runReport(decisionPath, artifactPath, summaryPath)
    const artifact = validateDecision(JSON.parse(readFileSync(artifactPath, 'utf8')), true)
    assert.deepEqual(artifact.observation, expectedObservation)
    assert.doesNotMatch(readFileSync(summaryPath, 'utf8'), /bad\|`<name>/u)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
