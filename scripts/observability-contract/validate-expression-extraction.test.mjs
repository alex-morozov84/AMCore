import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  getAllExpressions,
  getRecordingRuleNames,
  runAgainstRealRepo,
  validateEveryExpressionIsNonEmpty,
} from './validate-expression-extraction.mjs'

test('an empty expr is rejected', () => {
  const violations = validateEveryExpressionIsNonEmpty([
    { expr: '  ', file: 'a.yml', line: 1, label: 'alert X' },
  ])
  assert.equal(violations.length, 1)
  assert.match(violations[0], /empty expr/)
})

test('a non-empty expr passes', () => {
  assert.deepEqual(
    validateEveryExpressionIsNonEmpty([{ expr: 'up', file: 'a.yml', line: 1, label: 'alert X' }]),
    []
  )
})

test('real repository yields every expr non-empty', () => {
  assert.deepEqual(runAgainstRealRepo(), [])
})

test('real repository expression count covers alerts, dashboard targets, and runbook fences', () => {
  const all = getAllExpressions()
  // 34 alerting rules (32 default + 2 optional SLO) + 6 recording rules +
  // 33 dashboard panel targets (some panels plot more than one series) + 15
  // tagged runbook fences (realtime.md's rejected_user/rejected_global query
  // pair was split into two single-query fences during this track — every
  // fence carries exactly one PromQL statement, matching every other one).
  assert.equal(all.length, 34 + 6 + 33 + 15)
})

test('recording rule names are read from the rule files, not hand-copied', () => {
  const names = getRecordingRuleNames()
  assert.ok(names.includes('amcore:slo_target'))
  assert.ok(names.includes('amcore:http_requests:error_ratio5m'))
  assert.equal(names.length, 6)
})
