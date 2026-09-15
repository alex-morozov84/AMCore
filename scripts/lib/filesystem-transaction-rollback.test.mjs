import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, readFileSync, symlinkSync } from 'node:fs'
import path from 'node:path'

import {
  applyFilesystemTransaction,
  FilesystemApplyError,
  readFilesystemTransactionJournal,
} from './filesystem-transaction.mjs'
import {
  assertNoTransactionArtifacts,
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

function expectRestored(run, before) {
  assert.throws(run, (error) => error instanceof FilesystemApplyError && error.restored)
  assert.deepEqual(filesystemSnapshot(fixture.root), before)
  assertNoTransactionArtifacts(fixture.root)
}

test('failure before the first target mutation leaves the exact snapshot unchanged', () => {
  const before = filesystemSnapshot(fixture.root)
  expectRestored(
    () =>
      applyFilesystemTransaction({
        root: fixture.root,
        operations: [{ kind: 'write', target: 'new/child', bytes: Buffer.from('new') }],
        hooks: {
          beforeMutation: () => {
            throw new Error('before mutation')
          },
        },
      }),
    before
  )
})

test('a failure after truncate restores exact bytes and executable mode', () => {
  writeFixture(fixture.root, 'script.sh', '#!/bin/sh\nold\n', 0o751)
  const before = filesystemSnapshot(fixture.root)
  expectRestored(
    () =>
      applyFilesystemTransaction({
        root: fixture.root,
        operations: [{ kind: 'write', target: 'script.sh', bytes: Buffer.from('new') }],
        hooks: {
          afterWriteTruncate: () => {
            throw new Error('after truncate')
          },
        },
      }),
    before
  )
})

test('mid-transaction failure rolls back the failed step, earlier steps, trees, and links', () => {
  writeFixture(fixture.root, 'first', 'one', 0o700)
  writeFixture(fixture.root, 'second', 'two', 0o640)
  writeFixture(fixture.root, 'tree/nested/file', 'tree', 0o600)
  chmodSync(path.join(fixture.root, 'tree'), 0o750)
  symlinkSync('../first', path.join(fixture.root, 'tree/link'))
  writeFixture(fixture.root, 'destination/old', 'old')
  const before = filesystemSnapshot(fixture.root)

  expectRestored(
    () =>
      applyFilesystemTransaction({
        root: fixture.root,
        operations: [
          { kind: 'write', target: 'created/deep/file', bytes: Buffer.from('created') },
          { kind: 'write', target: 'first', bytes: Buffer.from('changed'), mode: 0o600 },
          { kind: 'move', from: 'tree', to: 'destination' },
          { kind: 'delete', target: 'second' },
          { kind: 'write', target: 'never-reached', bytes: Buffer.from('no') },
        ],
        hooks: {
          afterMutation: ({ index }) => {
            if (index === 3) throw new Error('mid apply')
          },
        },
      }),
    before
  )
})

test('rollback failure keeps apply and undo diagnostics separate and preserves the journal', () => {
  writeFixture(fixture.root, 'first', 'first-original', 0o700)
  writeFixture(fixture.root, 'target', 'original', 0o755)
  let caught
  try {
    applyFilesystemTransaction({
      root: fixture.root,
      operations: [
        { kind: 'write', target: 'first', bytes: Buffer.from('first-changed') },
        { kind: 'write', target: 'target', bytes: Buffer.from('replacement') },
      ],
      hooks: rollbackFailureHooks(),
    })
  } catch (error) {
    caught = error
  }

  assert.ok(caught instanceof FilesystemApplyError)
  assert.equal(caught.restored, false)
  assert.match(caught.applyError.message, /apply exploded after truncate/)
  assert.match(caught.rollbackErrors[0].message, /rollback refused/)
  assert.equal(readFileSync(path.join(fixture.root, 'first'), 'utf8'), 'first-original')
  assert.equal(readFileSync(path.join(fixture.root, 'target')).length, 0)
  assert.equal(existsSync(caught.journalPath), true)
  const journal = readFilesystemTransactionJournal(fixture.root)
  assert.equal(journal.state, 'rollback-failed')
  assert.match(journal.applyError.message, /apply exploded after truncate/)
  assert.match(journal.rollbackErrors[0].message, /rollback refused/)
})

function rollbackFailureHooks() {
  return {
    afterWriteTruncate: ({ index }) => {
      if (index === 1) throw new Error('apply exploded after truncate')
    },
    beforeRollback: ({ index }) => {
      if (index === 1) throw new Error('rollback refused')
    },
  }
}
