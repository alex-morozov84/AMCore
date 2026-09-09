import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  runAgainstRealRepo,
  validatePrivatePathBoundary,
} from './validate-private-path-boundary.mjs'

test('accepts hits that exactly match the baseline', () => {
  const baseline = { entries: [{ file: 'a.ts', target: 'ai/STATUS.md', count: 2, kind: 'debt' }] }
  const hits = [
    { file: 'a.ts', target: 'ai/STATUS.md', line: 1 },
    { file: 'a.ts', target: 'ai/STATUS.md', line: 5 },
  ]
  assert.deepEqual(validatePrivatePathBoundary(hits, baseline), [])
})

test('rejects a citation with no baseline entry at all', () => {
  const baseline = { entries: [] }
  const hits = [{ file: 'a.ts', target: 'ai/DECISIONS.md', line: 1 }]
  const violations = validatePrivatePathBoundary(hits, baseline)
  assert.equal(violations.length, 1)
  assert.match(violations[0], /a\.ts/)
  assert.match(violations[0], /ai\/DECISIONS\.md/)
})

test('rejects a citation count higher than the baseline allows', () => {
  const baseline = { entries: [{ file: 'a.ts', target: 'ai/STATUS.md', count: 1, kind: 'debt' }] }
  const hits = [
    { file: 'a.ts', target: 'ai/STATUS.md', line: 1 },
    { file: 'a.ts', target: 'ai/STATUS.md', line: 9 },
  ]
  const violations = validatePrivatePathBoundary(hits, baseline)
  assert.equal(violations.length, 1)
  assert.match(violations[0], /exceed the baseline's 1/)
})

test('a baseline entry shrinking to zero live hits is fine (ratchet only tightens)', () => {
  const baseline = { entries: [{ file: 'a.ts', target: 'ai/STATUS.md', count: 3, kind: 'debt' }] }
  assert.deepEqual(validatePrivatePathBoundary([], baseline), [])
})

test('real repository state matches the committed baseline exactly', () => {
  assert.deepEqual(runAgainstRealRepo(), [])
})
