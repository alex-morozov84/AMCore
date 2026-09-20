import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { buildOperationInventory } from './operation-inventory.mjs'
import { ROUTE_PROGRESS_SOURCE_PATH } from '../lib/project-route-progress-ownership.mjs'

describe('operation inventory against the real plans', () => {
  const inventory = buildOperationInventory()

  test('records real source/target paths and every measured scenario', () => {
    assert.equal(inventory.operations.length, 476)
    assert.equal(new Set(inventory.operations.map((operation) => operation.scenarioName)).size, 8)
    assert.ok(
      inventory.operations.every(
        (operation) => operation.target && !operation.target.startsWith('/')
      )
    )
    assert.ok(
      inventory.operations.every(
        (operation) =>
          operation.modulePath === 'scripts/lib/project-locale-materializer.mjs' ||
          operation.modulePath === 'scripts/lib/project-shared-content.mjs' ||
          operation.modulePath === 'scripts/lib/project-console-facts.mjs' ||
          operation.modulePath === 'scripts/lib/project-storybook-facts.mjs'
      )
    )
    assert.ok(inventory.operations.every((operation) => typeof operation.summary === 'string'))
  })

  test('reports providers, ownership, semantic units, and final M4 operations', () => {
    // `ConsoleLocaleSwitcher.tsx` is deleted whole under single-locale mode
    // (`LOCALE_DELETES`), not hidden at runtime: single-locale mode rewrites
    // `useRouteProgressRouter()` to the plain `next/navigation` router (no
    // object href, no `locale` option), so its navigation call cannot
    // type-check there regardless of any internal branch. Same pattern as
    // the product `LocaleSwitcher`'s removal.
    assert.deepEqual(inventory.migrationCounts, {
      productionProviders: 10,
      ownershipManifests: 10,
      semanticFacts: 652,
      semanticClaims: 1229,
      finalFilesystemOperations: 469,
    })
  })

  test('captures file, directory, move, delete, and edit evidence needed by PR2', () => {
    assert.ok(
      inventory.operations.some((operation) => operation.kind === 'move' && operation.source)
    )
    assert.ok(inventory.operations.some((operation) => operation.kind === 'delete'))
    assert.ok(inventory.operations.some((operation) => operation.targetType === 'directory'))
    assert.ok(inventory.operations.some((operation) => operation.kind === 'edit'))
  })

  test('publishes one synchronization edge for every distinct exact-copy target', () => {
    assert.equal(inventory.exactCopyEdges.length, 0)
    assert.equal(
      inventory.exactCopyEdges.some((edge) => edge.upstreamSource === ROUTE_PROGRESS_SOURCE_PATH),
      false
    )
    assert.equal(
      inventory.exactCopyEdges.some((edge) => edge.upstreamSource === 'apps/web/vitest.config.ts'),
      false
    )
    const targets = inventory.exactCopyEdges.map((edge) => edge.upstreamSource)
    assert.deepEqual(targets, [...new Set(targets)].sort())
    assert.ok(
      inventory.exactCopyEdges.every(
        (edge) => edge.upstreamSourceCount === 1 && edge.scenarios.length > 0
      )
    )
  })
})
