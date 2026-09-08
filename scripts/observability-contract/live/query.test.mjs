import assert from 'node:assert/strict'
import { test } from 'node:test'

import { collectVectorSelectorNames } from './query.mjs'

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
