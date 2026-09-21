import assert from 'node:assert/strict'
import { test } from 'node:test'

import { assertExactScaffoldCounts } from './scaffold-exact-counts.mjs'

test('reports every stale count as expected-to-actual values', () => {
  assert.throws(
    () =>
      assertExactScaffoldCounts([
        { name: 'first inventory', expected: 3, actual: 4 },
        { name: 'matching inventory', expected: 5, actual: 5 },
        { name: 'second inventory', expected: 7, actual: 9 },
      ]),
    (error) => {
      assert.match(error.message, /first inventory: 3 -> 4/)
      assert.match(error.message, /second inventory: 7 -> 9/)
      assert.equal(error.message.includes('matching inventory'), false)
      return true
    }
  )
})
