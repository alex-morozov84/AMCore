import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { applyFilesystemTransaction } from './filesystem-transaction.mjs'
import {
  assertNoTransactionArtifacts,
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

function expectPreflightFailure(operations, pattern) {
  const before = filesystemSnapshot(fixture.root)
  assert.throws(() => applyFilesystemTransaction({ root: fixture.root, operations }), pattern)
  assert.deepEqual(filesystemSnapshot(fixture.root), before)
  assertNoTransactionArtifacts(fixture.root)
}

test('absolute and escaping paths are rejected without changes', () => {
  expectPreflightFailure(
    [{ kind: 'write', target: '/absolute', bytes: Buffer.from('x') }],
    /must be repository-relative/
  )
  expectPreflightFailure([{ kind: 'delete', target: '../outside' }], /escapes the repository root/)
})

test('a symlink ancestor is rejected and never writes outside the transaction root', () => {
  external = mkdtempSync(path.join(tmpdir(), 'amcore-transaction-outside-'))
  writeFixture(external, 'sentinel', 'safe')
  symlinkSync(external, path.join(fixture.root, 'escape'))
  expectPreflightFailure(
    [{ kind: 'write', target: 'escape/sentinel', bytes: Buffer.from('unsafe') }],
    /symlink ancestor/
  )
  assert.equal(readFileSync(path.join(external, 'sentinel'), 'utf8'), 'safe')
})

test('write-to-directory, missing move source, and unsafe overlaps fail preflight', () => {
  mkdirSync(path.join(fixture.root, 'directory'))
  expectPreflightFailure(
    [{ kind: 'write', target: 'directory', bytes: Buffer.from('x') }],
    /write target is a directory/
  )
  expectPreflightFailure(
    [{ kind: 'move', from: 'missing', to: 'destination' }],
    /move source does not exist/
  )
  writeFixture(fixture.root, 'parent/child', 'x')
  expectPreflightFailure(
    [{ kind: 'move', from: 'parent', to: 'parent/nested' }],
    /nested endpoints/
  )
  expectPreflightFailure(
    [
      { kind: 'delete', target: 'parent' },
      { kind: 'write', target: 'parent/child', bytes: Buffer.from('x') },
    ],
    /unsupported overlapping paths/
  )
})

test('an unsupported special object anywhere in a touched tree fails preflight', () => {
  mkdirSync(path.join(fixture.root, 'tree'))
  const fifo = path.join(fixture.root, 'tree', 'named-pipe')
  execFileSync('mkfifo', [fifo])
  expectPreflightFailure([{ kind: 'delete', target: 'tree' }], /unsupported special filesystem/)
})
