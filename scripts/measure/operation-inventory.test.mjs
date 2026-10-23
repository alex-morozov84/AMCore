import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { buildOperationInventory } from './operation-inventory.mjs'
import { ROUTE_PROGRESS_SOURCE_PATH } from '../lib/project-route-progress-ownership.mjs'
import { assertExactScaffoldCounts } from '../lib/scaffold-exact-counts.mjs'

describe('operation inventory against the real plans', () => {
  const inventory = buildOperationInventory()

  test('reports every stale measured exact count together', () => {
    assertExactScaffoldCounts([
      // T060 adds relocated admin routes, completion/compatibility adapters and explicit
      // staff CI ownership. These are combined source inventories, not new providers.
      // Two catalogue-bound role fixtures add selected-locale edits; the two
      // accessibility stories add Storybook-disabled deletions. The Console external tool links add
      // two shared modules with tests and their environment, compose and stand entries. Providers stay fixed.
      // Own-key settings add a page move and two pathname edits in three locale
      // recipes (+9), plus three story deletions in two Storybook-off recipes
      // (+6): 15 additional operations/facts/claims. No new provider or manifest.
      // The Alert catalogue fixture adds one edit in each of three single-locale
      // recipes (+3 operations/facts/claims); its Storybook deletions already exist.
      // Integration docs add two retained-file edits with four owned blocks in the Console-off recipe.
      // Each content fact and its claims appear in both the shared and Console semantic inventories:
      // +4 facts, +8 claims, but only two final edits.
      { name: 'measured operations', expected: 882, actual: inventory.operations.length },
      {
        name: 'operation scenarios',
        expected: 8,
        actual: new Set(inventory.operations.map((item) => item.scenarioName)).size,
      },
      { name: 'exact-copy edges', expected: 0, actual: inventory.exactCopyEdges.length },
      {
        name: 'migration providers',
        expected: 10,
        actual: inventory.migrationCounts.productionProviders,
      },
      {
        name: 'migration manifests',
        expected: 10,
        actual: inventory.migrationCounts.ownershipManifests,
      },
      {
        name: 'migration semantic facts',
        expected: 1214,
        actual: inventory.migrationCounts.semanticFacts,
      },
      {
        name: 'migration semantic claims',
        expected: 1991,
        actual: inventory.migrationCounts.semanticClaims,
      },
      {
        name: 'migration final filesystem operations',
        expected: 862,
        actual: inventory.migrationCounts.finalFilesystemOperations,
      },
    ])
  })

  test('records real source/target paths and every measured scenario', () => {
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
    assert.deepEqual(Object.keys(inventory.migrationCounts).sort(), [
      'finalFilesystemOperations',
      'ownershipManifests',
      'productionProviders',
      'semanticClaims',
      'semanticFacts',
    ])
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
