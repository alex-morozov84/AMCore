import test from 'node:test'
import assert from 'node:assert/strict'
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
