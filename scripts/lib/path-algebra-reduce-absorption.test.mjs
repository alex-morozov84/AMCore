import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { reducePathAlgebra } from './path-algebra-reduce.mjs'
import { CONFLICT_CODES } from './path-algebra-errors.mjs'
import { conflict } from './path-algebra-test-helpers.mjs'

describe('reducePathAlgebra — move+content carry-forward, absorption, extraction', () => {
  test('a content edit on a move source is carried to the final destination', () => {
    const ops = reducePathAlgebra([
      { kind: 'move', from: 'a', to: 'b', dimension: 'x' },
      { kind: 'content', path: 'a', dimension: 'y' },
    ])
    assert.equal(ops.length, 1)
    assert.equal(ops[0].kind, 'move')
    assert.equal(ops[0].to, 'b')
    assert.equal(ops[0].carriedContent.length, 1)
    assert.equal(ops[0].carriedContent[0].dimension, 'y')
  })

  test('a descendant delete is absorbed by an ancestor directory delete', () => {
    const ops = reducePathAlgebra([
      { kind: 'delete', path: 'dir', dimension: 'x' },
      { kind: 'delete', path: 'dir/child.ts', dimension: 'y' },
    ])
    assert.equal(ops.length, 1)
    assert.equal(ops[0].target, 'dir')
  })

  test('a descendant content edit is absorbed by an ancestor directory delete', () => {
    const ops = reducePathAlgebra([
      { kind: 'delete', path: 'dir', dimension: 'x' },
      { kind: 'content', path: 'dir/child.ts', dimension: 'y' },
    ])
    assert.equal(ops.length, 1)
    assert.equal(ops[0].kind, 'delete')
  })

  test('a descendant move source is extracted before the ancestor delete', () => {
    const ops = reducePathAlgebra([
      { kind: 'delete', path: 'dir', dimension: 'x' },
      { kind: 'move', from: 'dir/keep.ts', to: 'elsewhere/keep.ts', dimension: 'y' },
    ])
    assert.equal(ops.length, 2)
    assert.ok(ops.some((op) => op.kind === 'delete' && op.target === 'dir'))
    assert.ok(ops.some((op) => op.kind === 'move' && op.to === 'elsewhere/keep.ts'))
  })

  test('the extraction move is materialized in the array BEFORE its ancestor delete (real ordering, not just presence)', () => {
    // Deliberately named so the ancestor delete ("dir") would sort ALPHABETICALLY
    // before the move's own keys if ordering were naive alphabetical sort —
    // proves this is a real topological guarantee, not a coincidence of sort order.
    const ops = reducePathAlgebra([
      { kind: 'delete', path: 'dir', dimension: 'x' },
      { kind: 'move', from: 'dir/zzz-keep.ts', to: 'aaa-elsewhere/keep.ts', dimension: 'y' },
    ])
    const deleteIndex = ops.findIndex((op) => op.kind === 'delete')
    const moveIndex = ops.findIndex((op) => op.kind === 'move')
    assert.ok(moveIndex < deleteIndex, 'extraction move must precede the ancestor delete in execution order')
  })

  test('two extractions from the same ancestor both precede it, and are themselves ordered deterministically', () => {
    const facts = [
      { kind: 'delete', path: 'dir', dimension: 'x' },
      { kind: 'move', from: 'dir/b.ts', to: 'out/b.ts', dimension: 'y' },
      { kind: 'move', from: 'dir/a.ts', to: 'out/a.ts', dimension: 'z' },
    ]
    const ops = reducePathAlgebra(facts)
    const deleteIndex = ops.findIndex((op) => op.kind === 'delete')
    const moveIndices = ops.map((op, i) => (op.kind === 'move' ? i : -1)).filter((i) => i !== -1)
    assert.ok(moveIndices.every((i) => i < deleteIndex))
    assert.deepEqual(reducePathAlgebra([...facts].reverse()), ops)
  })

  test('a move both into and out of the same doomed directory is absorbed entirely', () => {
    const ops = reducePathAlgebra([
      { kind: 'delete', path: 'dir', dimension: 'x' },
      { kind: 'move', from: 'dir/a.ts', to: 'dir/b.ts', dimension: 'y' },
    ])
    assert.equal(ops.length, 1)
    assert.equal(ops[0].kind, 'delete')
  })

  test('a move landing inside a deleted directory, sourced from outside it, is an unresolved conflict', () => {
    assert.throws(
      () =>
        reducePathAlgebra([
          { kind: 'delete', path: 'dir', dimension: 'x' },
          { kind: 'move', from: 'outside/a.ts', to: 'dir/a.ts', dimension: 'y' },
        ]),
      conflict(CONFLICT_CODES.UNRESOLVED_OVERLAP)
    )
  })
})
