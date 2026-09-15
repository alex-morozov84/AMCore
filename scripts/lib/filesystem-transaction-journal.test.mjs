import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, symlinkSync } from 'node:fs'
import path from 'node:path'

import { applyFilesystemTransaction, FilesystemApplyError } from './filesystem-transaction.mjs'
import {
  createTransactionFixture,
  filesystemSnapshot,
  writeFixture,
} from './filesystem-transaction-test-helpers.mjs'

let fixture

beforeEach(() => {
  fixture = createTransactionFixture()
})

afterEach(() => {
  fixture.cleanup()
})

function prepareJournalFixture() {
  writeFixture(fixture.root, 'existing', Buffer.from([0, 1, 255]), 0o751)
  writeFixture(fixture.root, 'tree/file', 'nested', 0o600)
  chmodSync(path.join(fixture.root, 'tree'), 0o750)
  symlinkSync('../existing', path.join(fixture.root, 'tree/link'))
  symlinkSync('existing', path.join(fixture.root, 'link-source'))
  writeFixture(fixture.root, 'move-destination', 'overwritten', 0o640)
}

function journalOperations() {
  return [
    { kind: 'write', target: 'new-parent/new-file', bytes: Buffer.from('new') },
    { kind: 'write', target: 'existing', bytes: Buffer.from('changed') },
    { kind: 'delete', target: 'tree' },
    { kind: 'move', from: 'link-source', to: 'move-destination' },
  ]
}

function assertTypedUndo(published) {
  assert.equal(published.state, 'prepared')
  assert.equal(published.undoRecords[0].before.kind, 'missing')
  assert.deepEqual(
    { kind: published.undoRecords[1].before.kind, mode: published.undoRecords[1].before.mode },
    { kind: 'file', mode: 0o751 }
  )
  assert.equal(published.undoRecords[1].before.bytes, Buffer.from([0, 1, 255]).toString('base64'))
  assert.equal(published.undoRecords[2].before.kind, 'directory')
  assert.equal(published.undoRecords[2].before.entries[1].state.kind, 'symlink')
  assert.equal(published.undoRecords[3].sourceBefore.kind, 'symlink')
  assert.equal(published.undoRecords[3].destinationBefore.kind, 'file')
  assert.deepEqual(published.createdParents, ['new-parent'])
}

test('published undo records type every endpoint and created parent before mutation', () => {
  prepareJournalFixture()
  const before = filesystemSnapshot(fixture.root)
  let published
  const hooks = {
    afterJournalPublished: ({ journal }) => {
      published = JSON.parse(JSON.stringify(journal))
      throw new Error('inspect prepared journal')
    },
  }
  assert.throws(
    () =>
      applyFilesystemTransaction({ root: fixture.root, operations: journalOperations(), hooks }),
    (error) => error instanceof FilesystemApplyError && error.restored
  )
  assertTypedUndo(published)
  assert.deepEqual(filesystemSnapshot(fixture.root), before)
})
