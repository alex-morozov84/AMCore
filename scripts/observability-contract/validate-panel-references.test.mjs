import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  runAgainstRealRepo,
  validateDatasourceConsistency,
  validatePanelCitations,
} from './validate-panel-references.mjs'

const model = () => ({
  rows: [
    {
      title: 'HTTP',
      panels: [
        {
          title: 'Request rate',
          targets: [{ expr: 'x', datasource: { type: 'prometheus', uid: 'amcore-prometheus' } }],
        },
      ],
    },
  ],
})

test('datasource consistency passes when every target matches the provisioned uid', () => {
  assert.deepEqual(validateDatasourceConsistency(model(), 'amcore-prometheus'), [])
})

test('datasource consistency fails on a mutated/nonexistent uid', () => {
  const bad = model()
  bad.rows[0].panels[0].targets[0].datasource.uid = 'does-not-exist'
  const violations = validateDatasourceConsistency(bad, 'amcore-prometheus')
  assert.equal(violations.length, 1)
  assert.match(violations[0], /does-not-exist/)
})

test('panel citation without a row is rejected', () => {
  const citations = [{ panel: 'Request rate', row: null, file: 'x.md', line: 3 }]
  const violations = validatePanelCitations(citations, [{ row: 'HTTP', panel: 'Request rate' }])
  assert.equal(violations.length, 1)
  assert.match(violations[0], /without a row/)
})

test('panel citation naming a nonexistent (row, panel) pair is rejected', () => {
  const citations = [{ panel: 'Ghost panel', row: 'HTTP', file: 'x.md', line: 3 }]
  const violations = validatePanelCitations(citations, [{ row: 'HTTP', panel: 'Request rate' }])
  assert.equal(violations.length, 1)
  assert.match(violations[0], /not a real dashboard panel/)
})

test('a valid (row, panel) citation passes', () => {
  const citations = [{ panel: 'Request rate', row: 'HTTP', file: 'x.md', line: 3 }]
  assert.deepEqual(validatePanelCitations(citations, [{ row: 'HTTP', panel: 'Request rate' }]), [])
})

test('real repository dashboard + runbooks pass with no violations', () => {
  assert.deepEqual(runAgainstRealRepo(), [])
})
