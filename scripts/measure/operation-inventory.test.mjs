import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { buildOperationInventory } from './operation-inventory.mjs'
import { ROUTE_PROGRESS_SOURCE_PATH } from '../lib/project-route-progress-ownership.mjs'

describe('operation inventory against the real plans', () => {
  const inventory = buildOperationInventory()

  test('records real source/target paths and every measured scenario', () => {
    assert.equal(inventory.operations.length, 367)
    assert.equal(new Set(inventory.operations.map((operation) => operation.scenarioName)).size, 8)
    assert.ok(
      inventory.operations.every(
        (operation) => operation.target && !operation.target.startsWith('/')
      )
    )
    assert.ok(
      inventory.operations.every(
        (operation) =>
          operation.modulePath?.startsWith('scripts/lib/project-plan-') ||
          operation.modulePath === 'scripts/lib/project-shared-content.mjs' ||
          operation.modulePath === 'scripts/lib/project-console-facts.mjs'
      )
    )
  })

  test('reports migration units separately from legacy operations', () => {
    assert.deepEqual(inventory.migrationCounts, {
      legacyOperations: 287,
      semanticFacts: 58,
      semanticClaims: 152,
      sharedContentOperations: 33,
      materializedFilesystemOperations: 366,
    })
  })

  test('captures file, directory, move, delete, and edit evidence needed by PR2', () => {
    assert.ok(
      inventory.operations.some((operation) => operation.kind === 'move' && operation.source)
    )
    assert.ok(inventory.operations.some((operation) => operation.kind === 'delete'))
    assert.ok(inventory.operations.some((operation) => operation.targetType === 'directory'))
    assert.ok(
      inventory.operations.some(
        (operation) => operation.adapterClass === 'whole-file-legacy-before-after'
      )
    )
  })

  test('publishes one synchronization edge for every distinct exact-copy target', () => {
    assert.equal(inventory.exactCopyEdges.length, 20)
    assert.equal(
      inventory.exactCopyEdges.some((edge) => edge.upstreamSource === ROUTE_PROGRESS_SOURCE_PATH),
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
