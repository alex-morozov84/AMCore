import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  findUntaggedPromqlLookingFences,
  runAgainstRealRepo,
} from './validate-runbook-fence-inventory.mjs'

test('an untagged fence containing an amcore_ metric is flagged', () => {
  const fences = [
    { tag: '', body: 'sum(rate(amcore_http_requests_total[5m]))', file: 'x.md', line: 3 },
  ]
  const violations = findUntaggedPromqlLookingFences(fences)
  assert.equal(violations.length, 1)
  assert.match(violations[0], /x\.md:3/)
})

test('a properly tagged promql fence is not flagged', () => {
  const fences = [
    { tag: 'promql', body: 'sum(rate(amcore_http_requests_total[5m]))', file: 'x.md', line: 3 },
  ]
  assert.deepEqual(findUntaggedPromqlLookingFences(fences), [])
})

test('an untagged fence with unrelated shell content is not flagged', () => {
  const fences = [{ tag: '', body: 'docker compose up -d', file: 'x.md', line: 3 }]
  assert.deepEqual(findUntaggedPromqlLookingFences(fences), [])
})

test('real repository runbooks have no untagged PromQL-looking fences', () => {
  assert.deepEqual(runAgainstRealRepo(), [])
})
