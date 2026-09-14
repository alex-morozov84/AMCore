import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { topologicalOrder } from './path-algebra-topological-order.mjs'

describe('topologicalOrder', () => {
  test('with no edges, orders purely by key', () => {
    const ops = [{ kind: 'delete', target: 'z' }, { kind: 'delete', target: 'a' }]
    const ordered = topologicalOrder(ops, [])
    assert.deepEqual(ordered.map((op) => op.target), ['a', 'z'])
  })

  test('a single extraction edge places the move before the delete regardless of key order', () => {
    const ops = [
      { kind: 'delete', target: 'aaa' },
      { kind: 'move', from: 'zzz/child', to: 'out/child' },
    ]
    const ordered = topologicalOrder(ops, [{ moveSource: 'zzz/child', ancestorDir: 'aaa' }])
    assert.deepEqual(
      ordered.map((op) => op.kind),
      ['move', 'delete']
    )
  })

  test('an edge referencing a key not present in operations is ignored (already absorbed elsewhere)', () => {
    const ops = [{ kind: 'delete', target: 'aaa' }]
    const ordered = topologicalOrder(ops, [{ moveSource: 'missing', ancestorDir: 'aaa' }])
    assert.equal(ordered.length, 1)
  })

  test('preserves every operation — no node is dropped', () => {
    const ops = [
      { kind: 'delete', target: 'dir1' },
      { kind: 'delete', target: 'dir2' },
      { kind: 'move', from: 'dir1/a', to: 'out/a' },
      { kind: 'move', from: 'dir2/b', to: 'out/b' },
      { kind: 'content', target: 'unrelated.ts' },
    ]
    const edges = [
      { moveSource: 'dir1/a', ancestorDir: 'dir1' },
      { moveSource: 'dir2/b', ancestorDir: 'dir2' },
    ]
    const ordered = topologicalOrder(ops, edges)
    assert.equal(ordered.length, ops.length)
  })

  test('result does not depend on the order operations/edges were passed in', () => {
    const ops = [
      { kind: 'delete', target: 'dir1' },
      { kind: 'delete', target: 'dir2' },
      { kind: 'move', from: 'dir1/a', to: 'out/a' },
      { kind: 'move', from: 'dir2/b', to: 'out/b' },
    ]
    const edges = [
      { moveSource: 'dir1/a', ancestorDir: 'dir1' },
      { moveSource: 'dir2/b', ancestorDir: 'dir2' },
    ]
    const forward = topologicalOrder(ops, edges)
    const reversed = topologicalOrder([...ops].reverse(), [...edges].reverse())
    assert.deepEqual(reversed, forward)
  })
})
