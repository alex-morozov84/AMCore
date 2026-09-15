import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeSync,
} from 'node:fs'
import path from 'node:path'

import { PendingFilesystemTransactionError } from './filesystem-transaction-errors.mjs'

export const JOURNAL_NAME = '.amcore-scaffold-transaction.json'
const TEMP_PREFIX = `${JOURNAL_NAME}.tmp-`
export const JOURNAL_STATES = Object.freeze([
  'publishing',
  'prepared',
  'applying',
  'rolling-back',
  'rollback-failed',
  'committed',
  'rolled-back',
])

export function filesystemTransactionJournalPath(root) {
  return path.join(root, JOURNAL_NAME)
}

function syncDirectory(root) {
  const descriptor = openSync(root, 'r')
  try {
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

function writeAndSync(file, content) {
  const descriptor = openSync(file, 'wx', 0o600)
  try {
    const bytes = Buffer.from(content)
    let offset = 0
    while (offset < bytes.length) offset += writeSync(descriptor, bytes, offset)
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

function temporaryPath(root) {
  return path.join(root, `${TEMP_PREFIX}${process.pid}-${Date.now()}-${Math.random()}`)
}

function reserveJournal(root, target) {
  try {
    writeAndSync(target, `${JSON.stringify({ version: 1, state: 'publishing' })}\n`)
    syncDirectory(root)
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new PendingFilesystemTransactionError(target, journalState(root))
    }
    throw error
  }
}

export function publishFilesystemJournal(root, journal, { exclusive = false } = {}) {
  const target = filesystemTransactionJournalPath(root)
  const temporary = temporaryPath(root)
  let reserved = false
  try {
    if (exclusive) {
      reserveJournal(root, target)
      reserved = true
    }
    writeAndSync(temporary, `${JSON.stringify(journal, null, 2)}\n`)
    renameSync(temporary, target)
    syncDirectory(root)
  } catch (error) {
    rmSync(temporary, { force: true })
    if (reserved) removeFilesystemJournal(root)
    throw error
  }
  return target
}

export function removeFilesystemJournal(root) {
  rmSync(filesystemTransactionJournalPath(root), { force: true })
  syncDirectory(root)
}

export function readFilesystemTransactionJournal(root) {
  const journalPath = filesystemTransactionJournalPath(root)
  if (!existsSync(journalPath)) return undefined
  return JSON.parse(readFileSync(journalPath, 'utf8'))
}

function journalState(root) {
  try {
    return readFilesystemTransactionJournal(root)?.state ?? 'unknown'
  } catch {
    return 'unreadable'
  }
}

export function assertNoFilesystemTransaction(root) {
  const files = readdirSync(root)
  const artifacts = files.filter((name) => name === JOURNAL_NAME || name.startsWith(TEMP_PREFIX))
  if (!artifacts.length) return
  throw new PendingFilesystemTransactionError(
    filesystemTransactionJournalPath(root),
    journalState(root)
  )
}

export function transitionFilesystemJournal(root, journal, state, detail = {}) {
  if (!JOURNAL_STATES.includes(state)) throw new TypeError(`unknown journal state "${state}"`)
  const next = { ...journal, state, ...detail, updatedAt: new Date().toISOString() }
  publishFilesystemJournal(root, next)
  return next
}
