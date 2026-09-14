import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { reducePathAlgebra } from './path-algebra-reduce.mjs'
import { CONFLICT_CODES } from './path-algebra-errors.mjs'
import { InvalidPathError } from './path-algebra-normalize.mjs'
import { conflict } from './path-algebra-test-helpers.mjs'

describe('reducePathAlgebra — basic composition and path validation', () => {
  test('independent sibling paths compose freely with no interaction', () => {
    const ops = reducePathAlgebra([
      { kind: 'delete', path: 'apps/web/a.ts', dimension: 'x' },
      { kind: 'content', path: 'apps/web/b.ts', dimension: 'y' },
    ])
    assert.deepEqual(
      ops.map((op) => op.kind).sort(),
      ['content', 'delete']
    )
  })

  test('"foo" delete does not absorb or conflict with "foobar" content (the B1 regression)', () => {
    const ops = reducePathAlgebra([
      { kind: 'delete', path: 'foo', dimension: 'x' },
      { kind: 'content', path: 'foobar', dimension: 'y' },
    ])
    assert.equal(ops.length, 2)
    assert.ok(ops.some((op) => op.kind === 'delete' && op.target === 'foo'))
    assert.ok(ops.some((op) => op.kind === 'content' && op.target === 'foobar'))
  })

  test('an absolute path fails before mutation', () => {
    assert.throws(
      () => reducePathAlgebra([{ kind: 'delete', path: '/etc/passwd', dimension: 'x' }]),
      InvalidPathError
    )
  })

  test('a ".." escape fails before mutation', () => {
    assert.throws(
      () => reducePathAlgebra([{ kind: 'delete', path: '../outside', dimension: 'x' }]),
      InvalidPathError
    )
  })
})

describe('reducePathAlgebra — dedup and conflicts', () => {
  test('a move chain collapses to one operation at the final destination', () => {
    const ops = reducePathAlgebra([
      { kind: 'move', from: 'a', to: 'b', dimension: 'x' },
      { kind: 'move', from: 'b', to: 'c', dimension: 'y' },
      { kind: 'content', path: 'b', dimension: 'rewrite' },
    ])
    assert.equal(ops.length, 1)
    assert.deepEqual(ops[0], {
      kind: 'move',
      from: 'a',
      to: 'c',
      carriedContent: [{ kind: 'content', path: 'b', dimension: 'rewrite' }],
    })
  })

  test('identical deletes from two dimensions deduplicate to one operation', () => {
    const ops = reducePathAlgebra([
      { kind: 'delete', path: 'a/b.ts', dimension: 'x' },
      { kind: 'delete', path: 'a/b.ts', dimension: 'y' },
    ])
    assert.equal(ops.length, 1)
    assert.equal(ops[0].kind, 'delete')
  })

  test('identical moves from two dimensions deduplicate to one operation', () => {
    const ops = reducePathAlgebra([
      { kind: 'move', from: 'a', to: 'b', dimension: 'x' },
      { kind: 'move', from: 'a', to: 'b', dimension: 'y' },
    ])
    assert.equal(ops.length, 1)
    assert.equal(ops[0].kind, 'move')
  })

  test('one source to two different destinations is rejected', () => {
    assert.throws(
      () =>
        reducePathAlgebra([
          { kind: 'move', from: 'a', to: 'b', dimension: 'x' },
          { kind: 'move', from: 'a', to: 'c', dimension: 'y' },
        ]),
      conflict(CONFLICT_CODES.MOVE_DESTINATION_MISMATCH)
    )
  })

  test('two different sources to one destination is rejected', () => {
    assert.throws(
      () =>
        reducePathAlgebra([
          { kind: 'move', from: 'a', to: 'c', dimension: 'x' },
          { kind: 'move', from: 'b', to: 'c', dimension: 'y' },
        ]),
      conflict(CONFLICT_CODES.COMPETING_MOVE_DESTINATION)
    )
  })

  test('a move cycle is rejected', () => {
    assert.throws(
      () =>
        reducePathAlgebra([
          { kind: 'move', from: 'a', to: 'b', dimension: 'x' },
          { kind: 'move', from: 'b', to: 'a', dimension: 'y' },
        ]),
      conflict(CONFLICT_CODES.MOVE_CYCLE)
    )
  })

  test('deleting a move source is rejected', () => {
    assert.throws(
      () =>
        reducePathAlgebra([
          { kind: 'move', from: 'a', to: 'b', dimension: 'x' },
          { kind: 'delete', path: 'a', dimension: 'y' },
        ]),
      conflict(CONFLICT_CODES.DELETE_OF_MOVE_SOURCE)
    )
  })

  test('delete and content-edit of the exact same path is rejected', () => {
    assert.throws(
      () =>
        reducePathAlgebra([
          { kind: 'delete', path: 'a/b.ts', dimension: 'x' },
          { kind: 'content', path: 'a/b.ts', dimension: 'y' },
        ]),
      conflict(CONFLICT_CODES.DELETE_CONTENT_CONFLICT)
    )
  })
})
