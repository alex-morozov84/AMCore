import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'

import { createRealRepoCopy } from './test-fixture.mjs'
import {
  assertExpectedCollisionGraph,
  buildLegacyCollisionGraph,
  EXPECTED_SHARED_COLLISION_GRAPH,
} from './project-collision-graph.mjs'

const copy = createRealRepoCopy()
after(() => copy.cleanup())

describe('generated remaining-provider collision graph', () => {
  it('matches the exact post-Console-migration snapshot', () => {
    const graph = buildLegacyCollisionGraph(copy.root)
    assert.deepEqual(graph, EXPECTED_SHARED_COLLISION_GRAPH)
    assert.deepEqual(Object.keys(graph).sort(), [
      'PROJECT_CONTEXT.md',
      'apps/web/eslint.config.mjs',
    ])
  })

  it('contains no Console provider or message lifecycle collision', () => {
    const graph = buildLegacyCollisionGraph(copy.root)
    assert.equal(graph['apps/web/messages/en.json'], undefined)
    assert.equal(graph['apps/web/messages/ru.json'], undefined)
    assert.ok(
      Object.entries(graph)
        .flatMap(([, contributors]) => contributors)
        .every((item) => item.endsWith(':edit') && !item.startsWith('console:'))
    )
  })

  it('fails closed when an unexpected shared path appears', () => {
    const changed = {
      ...buildLegacyCollisionGraph(copy.root),
      'unexpected.md': ['a:edit', 'b:edit'],
    }
    assert.throws(() => assertExpectedCollisionGraph(changed), /collision graph changed/)
  })
})
