import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'

import { createRealRepoCopy } from './test-fixture.mjs'
import {
  assertExpectedCollisionGraph,
  buildLegacyCollisionGraph,
  EXPECTED_SHARED_COLLISION_GRAPH,
} from './project-collision-graph.mjs'
import { SHARED_CONTENT_PATHS } from './project-shared-content-facts.mjs'

const copy = createRealRepoCopy()
after(() => copy.cleanup())

describe('generated legacy collision graph', () => {
  it('matches the exact nine-path expected snapshot', () => {
    const graph = buildLegacyCollisionGraph(copy.root)
    assert.deepEqual(graph, EXPECTED_SHARED_COLLISION_GRAPH)
    assert.deepEqual(Object.keys(graph).sort(), [...SHARED_CONTENT_PATHS].sort())
  })

  it('distinguishes message lifecycle overlap from content collisions', () => {
    const graph = buildLegacyCollisionGraph(copy.root)
    assert.deepEqual(graph['apps/web/messages/en.json'], ['console:edit', 'locale:delete'])
    assert.deepEqual(graph['apps/web/messages/ru.json'], ['console:edit', 'locale:delete'])
    assert.ok(
      Object.entries(graph)
        .filter(([pathname]) => !pathname.includes('/messages/'))
        .every(([, contributors]) => contributors.every((item) => item.endsWith(':edit')))
    )
  })

  it('fails closed when a tenth shared path appears', () => {
    const changed = {
      ...buildLegacyCollisionGraph(copy.root),
      'unexpected.md': ['a:edit', 'b:edit'],
    }
    assert.throws(() => assertExpectedCollisionGraph(changed), /collision graph changed/)
  })
})
