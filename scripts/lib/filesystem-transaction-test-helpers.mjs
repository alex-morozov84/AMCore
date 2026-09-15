import assert from 'node:assert/strict'
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { JOURNAL_NAME } from './filesystem-transaction-journal.mjs'

export function createTransactionFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'amcore-filesystem-transaction-'))
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true, maxRetries: 3 }),
  }
}

export function writeFixture(root, relative, bytes, mode = 0o644) {
  const absolute = path.join(root, relative)
  mkdirSync(path.dirname(absolute), { recursive: true })
  writeFileSync(absolute, bytes)
  chmodSync(absolute, mode)
  return absolute
}

function snapshotNode(absolute) {
  const stat = lstatSync(absolute)
  const mode = stat.mode & 0o7777
  if (stat.isSymbolicLink()) return { kind: 'symlink', target: readlinkSync(absolute) }
  if (stat.isFile()) return { kind: 'file', mode, hex: readFileSync(absolute).toString('hex') }
  if (!stat.isDirectory()) return { kind: 'special', mode }
  const entries = Object.fromEntries(
    readdirSync(absolute)
      .filter((name) => !name.startsWith(`${JOURNAL_NAME}.tmp-`))
      .sort()
      .map((name) => [name, snapshotNode(path.join(absolute, name))])
  )
  return { kind: 'directory', mode, entries }
}

export function filesystemSnapshot(root, { omitJournal = false } = {}) {
  const snapshot = snapshotNode(root)
  if (omitJournal) delete snapshot.entries[JOURNAL_NAME]
  return snapshot
}

export function assertNoTransactionArtifacts(root) {
  const artifacts = readdirSync(root).filter(
    (name) => name === JOURNAL_NAME || name.startsWith(`${JOURNAL_NAME}.tmp-`)
  )
  assert.deepEqual(artifacts, [])
}
