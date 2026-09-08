import assert from 'node:assert/strict'
import { test } from 'node:test'

import { diffDashboardModels } from './grafana.mjs'

const baseModel = () => ({
  rows: [
    {
      title: 'HTTP',
      panels: [
        {
          title: 'Request rate',
          targets: [
            {
              expr: 'sum(rate(x[5m]))',
              datasource: { type: 'prometheus', uid: 'amcore-prometheus' },
            },
          ],
        },
      ],
    },
  ],
})

test('identical committed and live models produce no violations', () => {
  assert.deepEqual(diffDashboardModels(baseModel(), baseModel()), [])
})

test('a drifted expr is caught', () => {
  const live = baseModel()
  live.rows[0].panels[0].targets[0].expr = 'sum(rate(y[5m]))'
  const violations = diffDashboardModels(baseModel(), live)
  assert.equal(violations.length, 1)
  assert.match(violations[0], /expr differs/)
})

test('a drifted datasource uid is caught', () => {
  const live = baseModel()
  live.rows[0].panels[0].targets[0].datasource.uid = 'wrong-uid'
  const violations = diffDashboardModels(baseModel(), live)
  assert.equal(violations.length, 1)
  assert.match(violations[0], /datasource uid differs/)
})

test('a missing row is caught', () => {
  const live = { rows: [] }
  const violations = diffDashboardModels(baseModel(), live)
  assert.equal(violations.length, 1)
  assert.match(violations[0], /row count differs/)
})
