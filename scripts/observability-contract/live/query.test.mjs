import assert from 'node:assert/strict'
import { test } from 'node:test'

import { checkMetricReferences, collectVectorSelectorNames } from './query.mjs'
import { getAllExpressions } from '../validate-expression-extraction.mjs'

test('collects a bare vectorSelector name', () => {
  const ast = { type: 'vectorSelector', name: 'up', matchers: [] }
  assert.deepEqual(collectVectorSelectorNames(ast), ['up'])
})

test('collects a matrixSelector name (rate(...[5m]) wrapping)', () => {
  const ast = {
    type: 'call',
    func: { name: 'rate' },
    args: [{ type: 'matrixSelector', name: 'amcore_http_requests_total', range: 300000 }],
  }
  assert.deepEqual(collectVectorSelectorNames(ast), ['amcore_http_requests_total'])
})

test('collects names from both sides of a binaryExpr (or/and)', () => {
  const ast = {
    type: 'binaryExpr',
    op: 'or',
    lhs: { type: 'vectorSelector', name: 'amcore_a' },
    rhs: { type: 'vectorSelector', name: 'amcore_b' },
  }
  assert.deepEqual(collectVectorSelectorNames(ast).sort(), ['amcore_a', 'amcore_b'])
})

test('does not collect a function name or a string literal as a metric name', () => {
  const ast = {
    type: 'call',
    func: { name: 'label_replace' },
    args: [
      { type: 'vectorSelector', name: 'amcore_x' },
      { type: 'stringLiteral', val: 'source' },
    ],
  }
  assert.deepEqual(collectVectorSelectorNames(ast), ['amcore_x'])
})

// R2 regression: a failed parse_query call must be a violation, not silently
// treated as "no metric names found" — reproduces the exact false-green
// Agent 2's cold review found by mocking every parse response as an error.
test('checkMetricReferences fails every expression when parse_query errors, instead of returning []', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    const href = String(url)
    if (href.includes('/api/v1/targets/metadata')) {
      return {
        json: async () => ({
          status: 'success',
          data: [
            { target: { job: 'amcore-api' }, metric: 'up', type: 'gauge' },
            { target: { job: 'amcore-worker' }, metric: 'up', type: 'gauge' },
          ],
        }),
      }
    }
    if (href.includes('/api/v1/parse_query')) {
      return {
        json: async () => ({ status: 'error', errorType: 'bad_data', error: 'mocked failure' }),
      }
    }
    throw new Error(`unexpected fetch: ${href}`)
  }
  // The real fetch mock above has no `.status` field (unlike a real Response),
  // so postJson's `response.status` would be undefined — patch just enough
  // for the guard's own `status < 200 || status >= 300` check to trip too.
  const wrapped = globalThis.fetch
  globalThis.fetch = async (...args) => ({ ...(await wrapped(...args)), status: 200 })

  try {
    const violations = await checkMetricReferences()
    const expressionCount = getAllExpressions().length
    assert.equal(
      violations.length,
      expressionCount,
      'every expression must be flagged, not silently passed'
    )
    assert.ok(violations.every((v) => v.includes('parse_query failed')))
  } finally {
    globalThis.fetch = originalFetch
  }
})
