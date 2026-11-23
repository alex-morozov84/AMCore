import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

export function caseDigest(ids) {
  assert.ok(ids.length > 0, 'Empty browser inventory')
  assert.equal(new Set(ids).size, ids.length, 'Duplicate browser cases')
  assert.ok(
    ids.every((id) => typeof id === 'string' && id.length > 0),
    'Invalid browser case ID'
  )
  return createHash('sha256')
    .update(JSON.stringify([...ids].sort()))
    .digest('hex')
}

export function proveBrowserCases(tests, expected) {
  assert.ok(
    tests.every(
      ({ expectedStatus, results }) =>
        expectedStatus === 'passed' && results.at(-1)?.status === 'passed'
    ),
    'A selected browser case failed or did not run'
  )
  const observed = caseDigest(tests.map((test) => test.id))
  assert.equal(observed, expected, 'Missing or unexpected browser case')
  return observed
}
