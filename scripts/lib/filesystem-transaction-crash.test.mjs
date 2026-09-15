import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  applyFilesystemTransaction,
  PendingFilesystemTransactionError,
  readFilesystemTransactionJournal,
} from './filesystem-transaction.mjs'
import {
  createTransactionFixture,
  filesystemSnapshot,
  writeFixture,
} from './filesystem-transaction-test-helpers.mjs'

const CHILD = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'filesystem-transaction-crash-child.mjs'
)
let fixture

beforeEach(() => {
  fixture = createTransactionFixture()
  writeFixture(fixture.root, 'target', 'original', 0o700)
})

afterEach(() => {
  fixture.cleanup()
})

function crashAt(point) {
  const result = spawnSync(process.execPath, [CHILD, fixture.root, point], { encoding: 'utf8' })
  assert.equal(result.signal, 'SIGKILL', result.stderr)
  return readFilesystemTransactionJournal(fixture.root)
}

function assertNextApplyBlocked() {
  assert.throws(
    () =>
      applyFilesystemTransaction({
        root: fixture.root,
        operations: [{ kind: 'write', target: 'other', bytes: Buffer.from('no') }],
      }),
    (error) =>
      error instanceof PendingFilesystemTransactionError &&
      /new apply is blocked/.test(error.message) &&
      /restore recorded states in reverse operation order/.test(error.message)
  )
  assert.equal(existsSync(path.join(fixture.root, 'other')), false)
}

test('kill after durable journal publication leaves prepared state and blocks a later apply', () => {
  const before = filesystemSnapshot(fixture.root)
  const journal = crashAt('journal')
  assert.equal(journal.state, 'prepared')
  assert.equal(journal.undoRecords[0].before.kind, 'file')
  assert.equal(
    lstatSync(path.join(fixture.root, '.amcore-scaffold-transaction.json')).mode & 0o777,
    0o600
  )
  assert.deepEqual(filesystemSnapshot(fixture.root, { omitJournal: true }), before)
  assertNextApplyBlocked()
})

test('kill after a mutation leaves applying state, does not auto-rollback, and blocks later apply', () => {
  const journal = crashAt('mutation')
  assert.equal(journal.state, 'applying')
  assert.equal(journal.currentStep, 0)
  assert.equal(readFileSync(path.join(fixture.root, 'target'), 'utf8'), 'mutated')
  assertNextApplyBlocked()
  assert.equal(readFileSync(path.join(fixture.root, 'target'), 'utf8'), 'mutated')
})
