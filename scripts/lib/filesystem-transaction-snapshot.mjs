import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

import { FilesystemTransactionError, TRANSACTION_CODES } from './filesystem-transaction-errors.mjs'

function statOrMissing(absolute) {
  try {
    return lstatSync(absolute)
  } catch (error) {
    if (error.code === 'ENOENT') return undefined
    throw error
  }
}

function modeOf(stat) {
  return stat.mode & 0o7777
}

function captureDirectory(absolute, stat) {
  const entries = readdirSync(absolute)
    .sort()
    .map((name) => ({
      name,
      state: captureFilesystemState(path.join(absolute, name)),
    }))
  return { kind: 'directory', mode: modeOf(stat), entries }
}

export function captureFilesystemState(absolute) {
  const stat = statOrMissing(absolute)
  if (!stat) return { kind: 'missing' }
  if (stat.isFile()) {
    return { kind: 'file', mode: modeOf(stat), bytes: readFileSync(absolute).toString('base64') }
  }
  if (stat.isDirectory()) return captureDirectory(absolute, stat)
  if (stat.isSymbolicLink()) {
    return { kind: 'symlink', target: readlinkSync(absolute), mode: modeOf(stat) }
  }
  throw new FilesystemTransactionError(
    TRANSACTION_CODES.INVALID_SHAPE,
    `unsupported special filesystem object at ${absolute}`,
    { paths: [absolute] }
  )
}

function restoreDirectory(absolute, state) {
  mkdirSync(absolute, { recursive: true, mode: 0o700 })
  for (const entry of state.entries) {
    restoreFilesystemState(path.join(absolute, entry.name), entry.state)
  }
  chmodSync(absolute, state.mode)
}

export function restoreFilesystemState(absolute, state) {
  rmSync(absolute, { recursive: true, force: true })
  if (state.kind === 'missing') return
  mkdirSync(path.dirname(absolute), { recursive: true })
  if (state.kind === 'file') {
    writeFileSync(absolute, Buffer.from(state.bytes, 'base64'))
    chmodSync(absolute, state.mode)
  } else if (state.kind === 'symlink') {
    symlinkSync(state.target, absolute)
  } else {
    restoreDirectory(absolute, state)
  }
}
