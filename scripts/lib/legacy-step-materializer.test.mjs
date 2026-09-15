import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { afterEach, describe, it } from 'node:test'
import path from 'node:path'

import { applyFilesystemTransaction } from './filesystem-transaction.mjs'
import {
  createTransactionFixture,
  filesystemSnapshot,
  writeFixture,
} from './filesystem-transaction-test-helpers.mjs'
import { materializeLegacySteps } from './legacy-step-materializer.mjs'

let fixture
afterEach(() => fixture?.cleanup())

function edit(target, after, extra = {}) {
  return { kind: 'edit', target, before: 'before', after, changed: true, summary: 'edit', ...extra }
}

describe('legacy step materializer', () => {
  it('materializes every supported legacy shape without mutation', () => {
    fixture = createTransactionFixture()
    const root = fixture.root
    const editTarget = writeFixture(root, 'edit.txt', 'before')
    const moveSource = writeFixture(root, 'move.txt', 'move')
    const rewriteSource = writeFixture(root, 'rewrite.txt', 'before', 0o755)
    const deleteTarget = writeFixture(root, 'delete.txt', 'delete')
    const copySource = writeFixture(root, 'source.png', Buffer.from('asset'), 0o751)
    const before = filesystemSnapshot(root)
    const steps = [
      edit(editTarget, 'after'),
      { kind: 'move', source: moveSource, target: path.join(root, 'moved.txt'), changed: true },
      edit(path.join(root, 'rewritten.txt'), 'rewritten', {
        adapterClass: 'move-and-rewrite',
        source: rewriteSource,
      }),
      { kind: 'delete', target: deleteTarget, changed: true },
      { kind: 'copy', source: copySource, target: path.join(root, 'copied.png'), changed: true },
    ]
    const plan = materializeLegacySteps(root, steps)
    assert.deepEqual(filesystemSnapshot(root), before)
    assert.ok(plan.displaySteps.every((step) => !('write' in step)))

    applyFilesystemTransaction({ root, operations: plan.operationsForApply() })
    assert.equal(readFileSync(editTarget, 'utf8'), 'after')
    assert.equal(readFileSync(path.join(root, 'moved.txt'), 'utf8'), 'move')
    assert.equal(readFileSync(path.join(root, 'rewritten.txt'), 'utf8'), 'rewritten')
    assert.equal(readFileSync(path.join(root, 'copied.png'), 'utf8'), 'asset')
  })

  it('uses M1 extraction ordering and ancestor absorption', () => {
    fixture = createTransactionFixture()
    const root = fixture.root
    const source = writeFixture(root, 'doomed/keep.txt', 'keep')
    writeFixture(root, 'doomed/drop.txt', 'drop')
    const plan = materializeLegacySteps(root, [
      { kind: 'delete', target: path.join(root, 'doomed'), changed: true },
      { kind: 'move', source, target: path.join(root, 'kept.txt'), changed: true },
      { kind: 'delete', target: path.join(root, 'doomed/drop.txt'), changed: true },
    ])
    assert.deepEqual(
      plan.operationsForApply().map((operation) => operation.kind),
      ['move', 'delete']
    )
    applyFilesystemTransaction({ root, operations: plan.operationsForApply() })
    assert.equal(readFileSync(path.join(root, 'kept.txt'), 'utf8'), 'keep')
  })

  it('fails closed for unknown, malformed, duplicate, and escaping steps', () => {
    fixture = createTransactionFixture()
    const root = fixture.root
    const target = writeFixture(root, 'target.txt', 'before')
    assert.throws(
      () => materializeLegacySteps(root, [{ kind: 'magic', changed: true }]),
      /unsupported/
    )
    assert.throws(() => materializeLegacySteps(root, [edit(target, undefined)]), /string after/)
    assert.throws(
      () => materializeLegacySteps(root, [edit(target, 'a'), edit(target, 'b')]),
      /duplicate effective writer/
    )
    assert.throws(
      () =>
        materializeLegacySteps(root, [
          { kind: 'delete', target: path.dirname(root), changed: true },
        ]),
      /escapes the transaction root/
    )
  })

  it('restores the full snapshot after an injected handled failure', () => {
    fixture = createTransactionFixture()
    const root = fixture.root
    const first = writeFixture(root, 'first.txt', 'first')
    const second = writeFixture(root, 'second.txt', 'second')
    const before = filesystemSnapshot(root)
    const plan = materializeLegacySteps(root, [edit(first, 'changed'), edit(second, 'changed')])
    assert.throws(
      () =>
        applyFilesystemTransaction({
          root,
          operations: plan.operationsForApply(),
          hooks: {
            beforeMutation: ({ index }) => {
              if (index === 1) throw new Error('injected')
            },
          },
        }),
      /snapshot was restored/
    )
    assert.deepEqual(filesystemSnapshot(root), before)
  })

  it('preserves the legacy move-and-rewrite destination mode', () => {
    fixture = createTransactionFixture()
    const source = writeFixture(fixture.root, 'source.txt', 'before', 0o755)
    const target = writeFixture(fixture.root, 'target.txt', 'old', 0o640)
    const plan = materializeLegacySteps(fixture.root, [
      edit(target, 'after', { adapterClass: 'move-and-rewrite', source }),
    ])
    applyFilesystemTransaction({ root: fixture.root, operations: plan.operationsForApply() })
    assert.equal(statSync(target).mode & 0o7777, 0o640)
  })
})
