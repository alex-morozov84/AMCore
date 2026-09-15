import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { applyFilesystemTransaction } from './filesystem-transaction.mjs'
import {
  assertNoTransactionArtifacts,
  createTransactionFixture,
  writeFixture,
} from './filesystem-transaction-test-helpers.mjs'

let fixture
let external

afterEach(() => {
  fixture?.cleanup()
  if (external) rmSync(external, { recursive: true, force: true })
  fixture = undefined
  external = undefined
})

function prepareSuccessFixture(root) {
  writeFixture(root, 'edit.txt', 'old', 0o640)
  writeFixture(root, 'delete.txt', 'delete')
  writeFixture(root, 'delete-tree/nested/file', 'tree')
  writeFixture(root, 'move-file', 'move', 0o751)
  writeFixture(root, 'move-tree/nested/file', 'tree-move', 0o600)
  chmodSync(path.join(root, 'move-tree'), 0o750)
  writeFixture(root, 'overwrite-source', 'source')
  writeFixture(root, 'overwrite-destination', 'destination')
  writeFixture(root, 'link-target', 'target')
  symlinkSync('link-target', path.join(root, 'link-source'))
  const externalFile = writeFixture(external, 'outside.txt', 'outside')
  symlinkSync(externalFile, path.join(root, 'symlink-destination'))
  writeFixture(root, 'symlink-overwrite-source', 'replacement')
  return externalFile
}

function successOperations() {
  return [
    { kind: 'write', target: 'new/deep/file', bytes: Buffer.from('new'), mode: 0o751 },
    { kind: 'write', target: 'edit.txt', bytes: Buffer.from('edited') },
    { kind: 'delete', target: 'delete.txt' },
    { kind: 'delete', target: 'delete-tree' },
    { kind: 'move', from: 'move-file', to: 'moved/file' },
    { kind: 'move', from: 'move-tree', to: 'moved/tree' },
    { kind: 'move', from: 'overwrite-source', to: 'overwrite-destination' },
    { kind: 'move', from: 'link-source', to: 'link-moved' },
    { kind: 'move', from: 'symlink-overwrite-source', to: 'symlink-destination' },
  ]
}

function assertSuccessfulTree(root, externalFile) {
  assert.equal(readFileSync(path.join(root, 'new/deep/file'), 'utf8'), 'new')
  assert.equal(lstatSync(path.join(root, 'new/deep/file')).mode & 0o7777, 0o751)
  assert.equal(readFileSync(path.join(root, 'edit.txt'), 'utf8'), 'edited')
  assert.equal(lstatSync(path.join(root, 'edit.txt')).mode & 0o7777, 0o640)
  assert.equal(existsSync(path.join(root, 'delete.txt')), false)
  assert.equal(existsSync(path.join(root, 'delete-tree')), false)
  assert.equal(lstatSync(path.join(root, 'moved/file')).mode & 0o7777, 0o751)
  assert.equal(lstatSync(path.join(root, 'moved/tree')).mode & 0o7777, 0o750)
  assert.equal(readFileSync(path.join(root, 'moved/tree/nested/file'), 'utf8'), 'tree-move')
  assert.equal(readFileSync(path.join(root, 'overwrite-destination'), 'utf8'), 'source')
  assert.equal(lstatSync(path.join(root, 'link-moved')).isSymbolicLink(), true)
  assert.equal(readlinkSync(path.join(root, 'link-moved')), 'link-target')
  assert.equal(readFileSync(path.join(root, 'symlink-destination'), 'utf8'), 'replacement')
  assert.equal(readFileSync(externalFile, 'utf8'), 'outside')
  assertNoTransactionArtifacts(root)
}

test('successful apply covers files, trees, overwrite, symlinks, modes, and cleanup', () => {
  fixture = createTransactionFixture()
  external = mkdtempSync(path.join(tmpdir(), 'amcore-transaction-external-'))
  const externalFile = prepareSuccessFixture(fixture.root)
  const result = applyFilesystemTransaction({ root: fixture.root, operations: successOperations() })
  assert.equal(result.applied, 9)
  assertSuccessfulTree(fixture.root, externalFile)
})

test('an ordered move extracts a file before its ancestor tree is deleted', () => {
  fixture = createTransactionFixture()
  writeFixture(fixture.root, 'feature/nested/keep', 'survivor', 0o700)

  applyFilesystemTransaction({
    root: fixture.root,
    operations: [
      { kind: 'move', from: 'feature/nested/keep', to: 'kept/file' },
      { kind: 'delete', target: 'feature' },
    ],
  })

  assert.equal(readFileSync(path.join(fixture.root, 'kept/file'), 'utf8'), 'survivor')
  assert.equal(lstatSync(path.join(fixture.root, 'kept/file')).mode & 0o7777, 0o700)
  assert.equal(existsSync(path.join(fixture.root, 'feature')), false)
  assertNoTransactionArtifacts(fixture.root)
})

test('move can materialize carried content as one operation-scoped rewrite', () => {
  fixture = createTransactionFixture()
  writeFixture(fixture.root, 'source.ts', 'before', 0o751)
  applyFilesystemTransaction({
    root: fixture.root,
    operations: [
      {
        kind: 'move',
        from: 'source.ts',
        to: 'nested/destination.ts',
        bytes: Buffer.from('after'),
      },
    ],
  })
  const destination = path.join(fixture.root, 'nested/destination.ts')
  assert.equal(existsSync(path.join(fixture.root, 'source.ts')), false)
  assert.equal(readFileSync(destination, 'utf8'), 'after')
  assert.equal(lstatSync(destination).mode & 0o7777, 0o751)
})
