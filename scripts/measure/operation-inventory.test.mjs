import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { buildOperationInventory } from './operation-inventory.mjs'
import { ROUTE_PROGRESS_SOURCE_PATH } from '../lib/project-route-progress-ownership.mjs'

describe('operation inventory against the real plans', () => {
  const inventory = buildOperationInventory()

  test('records real source/target paths and every measured scenario', () => {
    // +6: see the migrationCounts comment below.
    assert.equal(inventory.operations.length, 474)
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
    // Item 9 PR2 (Overview + locale switcher): +6 facts/claims/operations,
    // +4 final filesystem operations, over PR1's 640/1217/460. Revised twice
    // during PR2 itself: a runtime `SUPPORTED_LOCALES.length` guard on
    // `ConsoleLocaleSwitcher.tsx` first seemed enough, but single-locale
    // mode rewrites `useRouteProgressRouter()` to the plain `next/navigation`
    // router (no object href, no `locale` option), so the component's own
    // navigation call cannot type-check there regardless of any internal
    // branch. The working fix instead deletes the file whole under
    // single-locale mode - the same pattern the product `LocaleSwitcher`
    // already uses - via `LOCALE_DELETES`, a new
    // `locale.navigation-console-switcher` operation removing its
    // `ConsoleShell.tsx` usage (2 locales), and a `removeImports` seam
    // acknowledging its own `@/i18n/navigation` import disappears with it.
    assert.deepEqual(inventory.migrationCounts, {
      productionProviders: 10,
      ownershipManifests: 10,
      semanticFacts: 650,
      semanticClaims: 1227,
      finalFilesystemOperations: 467,
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
