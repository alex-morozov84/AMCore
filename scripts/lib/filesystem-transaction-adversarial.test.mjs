import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { applyFilesystemTransaction, FilesystemApplyError } from './filesystem-transaction.mjs'
import {
  createTransactionFixture,
  filesystemSnapshot,
  writeFixture,
} from './filesystem-transaction-test-helpers.mjs'

let fixture
let external

beforeEach(() => {
  fixture = createTransactionFixture()
})

afterEach(() => {
  fixture.cleanup()
  if (external) rmSync(external, { recursive: true, force: true })
  external = undefined
})

function assertRestoresSnapshot(operations, hooks) {
  const before = filesystemSnapshot(fixture.root)
  assert.throws(
    () => applyFilesystemTransaction({ root: fixture.root, operations, hooks }),
    (error) => error instanceof FilesystemApplyError && error.restored
  )
  assert.deepEqual(filesystemSnapshot(fixture.root), before)
}

test('write rollback restores a symlink object without touching its outside target', () => {
  external = mkdtempSync(path.join(tmpdir(), 'amcore-transaction-outside-'))
  const outside = writeFixture(external, 'outside', 'safe', 0o600)
  symlinkSync(outside, path.join(fixture.root, 'link'))
  assertRestoresSnapshot([{ kind: 'write', target: 'link', bytes: Buffer.from('replacement') }], {
    afterWriteTruncate: () => {
      throw new Error('after replacement truncate')
    },
  })
  assert.equal(readlinkSync(path.join(fixture.root, 'link')), outside)
  assert.equal(readFileSync(outside, 'utf8'), 'safe')
})

test('failed move after destination removal restores source and overwritten symlink', () => {
  writeFixture(fixture.root, 'source', 'source', 0o700)
  external = mkdtempSync(path.join(tmpdir(), 'amcore-transaction-outside-'))
  const outside = writeFixture(external, 'outside', 'safe')
  symlinkSync(outside, path.join(fixture.root, 'destination'))
  assertRestoresSnapshot([{ kind: 'move', from: 'source', to: 'destination' }], {
    afterMoveDestinationRemoval: () => {
      throw new Error('rename never started')
    },
  })
  assert.equal(readFileSync(outside, 'utf8'), 'safe')
})

test('rollback composes extraction and ancestor deletion snapshots', () => {
  writeFixture(fixture.root, 'feature/nested/keep', 'survivor', 0o700)
  writeFixture(fixture.root, 'feature/remove', 'remove', 0o640)
  assertRestoresSnapshot(
    [
      { kind: 'move', from: 'feature/nested/keep', to: 'kept/file' },
      { kind: 'delete', target: 'feature' },
      { kind: 'write', target: 'not-reached', bytes: Buffer.from('no') },
    ],
    {
      afterMutation: ({ index }) => {
        if (index === 1) throw new Error('after delete')
      },
    }
  )
})

test('a failed move rewrite restores both endpoints and source mode', () => {
  writeFixture(fixture.root, 'source', 'source-before', 0o751)
  writeFixture(fixture.root, 'destination', 'destination-before', 0o640)
  assertRestoresSnapshot(
    [
      {
        kind: 'move',
        from: 'source',
        to: 'destination',
        bytes: Buffer.from('rewritten'),
        mode: 0o600,
      },
    ],
    {
      afterWriteTruncate: () => {
        throw new Error('move rewrite truncated')
      },
    }
  )
})
