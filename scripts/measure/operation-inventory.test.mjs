import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { buildOperationInventory } from './operation-inventory.mjs'
import { ROUTE_PROGRESS_SOURCE_PATH } from '../lib/project-route-progress-ownership.mjs'

describe('operation inventory against the real plans', () => {
  const inventory = buildOperationInventory()

  test('records real source/target paths and every measured scenario', () => {
    // +6: see the migrationCounts comment below.
    assert.equal(inventory.operations.length, 464)
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
    // +6 facts/claims/operations over the original 632/1209/454: +2 for the
    // Organizations panel's path-mode e2e files registered in
    // operationsConsoleFacts.verification (detectable console contributions
    // outside every closed directory root), +4 for ConsoleNavigation.tsx and
    // ConsoleBreadcrumb.tsx needing their own locale.navigation-plain-pathname
    // rewrite (2 files x 2 locales) so single-locale mode doesn't leave a
    // dangling `@/i18n/navigation` import after that module is removed.
    assert.deepEqual(inventory.migrationCounts, {
      productionProviders: 10,
      ownershipManifests: 10,
      semanticFacts: 640,
      semanticClaims: 1217,
      finalFilesystemOperations: 460,
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
