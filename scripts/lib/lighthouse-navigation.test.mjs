import test from 'node:test'
import assert from 'node:assert/strict'
import { boundDocument } from '../lighthouse/session-probe.mjs'
import { admitNavigation, completeNavigation } from './lighthouse-navigation.mjs'
const url = 'https://owned.localhost/en/login'
test('pinned preparation and BFCache detours require a measured return; arbitrary navigation stays invalid', () => {
  const state = {}
  for (const next of ['about:blank', url, 'chrome://terms/', url]) admitNavigation(state, next, url)
  completeNavigation(state)
  for (const sequence of [
    ['about:blank', 'about:blank'],
    [url, 'chrome://terms/'],
    [url, 'https://foreign.invalid', url],
    [url, 'https://owned.localhost/en/mfa?flow=secret', url],
    [url, 'chrome://terms/', url, 'chrome://terms/'],
  ]) {
    const invalid = {}
    for (const next of sequence) {
      try {
        admitNavigation(invalid, next, url)
      } catch {
        /* final proof must retain this failure */
      }
    }
    assert.throws(() => completeNavigation(invalid))
  }
})

test('an intermediate document refusal survives a successful same-URL return', async () => {
  const state = {},
    records = [],
    results = []
  for (const bindingMatches of [false, true]) {
    admitNavigation(state, url, url)
    const record = { generation: state.measured, stage: 'binding', passed: false }
    records.push(record)
    try {
      await boundDocument({ evaluate: async () => bindingMatches }, 'fake-binding')
      record.passed = true
    } catch {
      record.code = 'measured-session-fence-missing'
    }
    results.push(record.passed)
  }
  completeNavigation(state)
  assert.equal(results.every(Boolean), false)
  assert.deepEqual(
    records.map((r) => r.generation),
    [1, 2]
  )
  assert.equal(records[0].passed, false)
  assert.equal(records[0].code, 'measured-session-fence-missing')
  assert.equal(records[1].passed, true)
})
