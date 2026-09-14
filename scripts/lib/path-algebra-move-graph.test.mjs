import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { buildMoveGraph } from './path-algebra-move-graph.mjs'
import { PathAlgebraConflictError, CONFLICT_CODES } from './path-algebra-errors.mjs'

describe('buildMoveGraph', () => {
  test('a single move resolves to its declared destination', () => {
    const graph = buildMoveGraph([{ from: 'a', to: 'b', dimension: 'x' }])
    assert.equal(graph.finalDestinationOf('a'), 'b')
  })

  test('identical move declarations from different dimensions deduplicate', () => {
    const graph = buildMoveGraph([
      { from: 'a', to: 'b', dimension: 'x' },
      { from: 'a', to: 'b', dimension: 'y' },
    ])
    assert.equal(graph.finalDestinationOf('a'), 'b')
    assert.deepEqual(graph.dimensionsOf('a').sort(), ['x', 'y'])
  })

  test('a chain resolves to its final destination', () => {
    const graph = buildMoveGraph([
      { from: 'a', to: 'b', dimension: 'x' },
      { from: 'b', to: 'c', dimension: 'y' },
    ])
    assert.equal(graph.finalDestinationOf('a'), 'c')
  })

  test('rejects one source declared to two different destinations', () => {
    assert.throws(
      () =>
        buildMoveGraph([
          { from: 'a', to: 'b', dimension: 'x' },
          { from: 'a', to: 'c', dimension: 'y' },
        ]),
      (error) => error instanceof PathAlgebraConflictError && error.code === CONFLICT_CODES.MOVE_DESTINATION_MISMATCH
    )
  })

  test('rejects two different sources resolving to one destination', () => {
    assert.throws(
      () =>
        buildMoveGraph([
          { from: 'a', to: 'c', dimension: 'x' },
          { from: 'b', to: 'c', dimension: 'y' },
        ]),
      (error) => error instanceof PathAlgebraConflictError && error.code === CONFLICT_CODES.COMPETING_MOVE_DESTINATION
    )
  })

  test('rejects a move cycle', () => {
    assert.throws(
      () =>
        buildMoveGraph([
          { from: 'a', to: 'b', dimension: 'x' },
          { from: 'b', to: 'c', dimension: 'y' },
          { from: 'c', to: 'a', dimension: 'z' },
        ]),
      (error) => error instanceof PathAlgebraConflictError && error.code === CONFLICT_CODES.MOVE_CYCLE
    )
  })

  test('rejects a direct self-move as a cycle', () => {
    assert.throws(
      () => buildMoveGraph([{ from: 'a', to: 'a', dimension: 'x' }]),
      (error) => error instanceof PathAlgebraConflictError && error.code === CONFLICT_CODES.MOVE_CYCLE
    )
  })

  test('a conflict diagnostic names every involved path and dimension, sorted', () => {
    try {
      buildMoveGraph([
        { from: 'a', to: 'b', dimension: 'zeta' },
        { from: 'a', to: 'c', dimension: 'alpha' },
      ])
      assert.fail('expected a conflict')
    } catch (error) {
      assert.ok(error instanceof PathAlgebraConflictError)
      assert.deepEqual(error.dimensions, ['alpha', 'zeta'])
      assert.ok(error.paths.includes('a'))
    }
  })

  test('independent, disjoint moves compose freely with no interaction', () => {
    const graph = buildMoveGraph([
      { from: 'a', to: 'z', dimension: 'x' },
      { from: 'm', to: 'n', dimension: 'y' },
    ])
    assert.equal(graph.finalDestinationOf('a'), 'z')
    assert.equal(graph.finalDestinationOf('m'), 'n')
  })
})
