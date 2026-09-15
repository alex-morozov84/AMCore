import {
  chmodSync,
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  writeSync,
} from 'node:fs'
import path from 'node:path'

import { absoluteEndpoint } from './filesystem-transaction-paths.mjs'

function existingKind(absolute) {
  try {
    const stat = lstatSync(absolute)
    if (stat.isFile()) return 'file'
    if (stat.isSymbolicLink()) return 'symlink'
    return 'other'
  } catch (error) {
    if (error.code === 'ENOENT') return 'missing'
    throw error
  }
}

function writeBytes(descriptor, bytes) {
  let offset = 0
  while (offset < bytes.length) offset += writeSync(descriptor, bytes, offset)
  fsyncSync(descriptor)
}

function applyWrite(root, operation, undo, hooks, index) {
  const target = absoluteEndpoint(root, operation.target)
  mkdirSync(path.dirname(target), { recursive: true })
  const kind = existingKind(target)
  if (kind !== 'file') rmSync(target, { recursive: true, force: true })
  const descriptor = openSync(target, kind === 'file' ? 'w' : 'wx', 0o600)
  try {
    hooks.afterWriteTruncate?.({ index })
    writeBytes(descriptor, operation.bytes)
  } finally {
    closeSync(descriptor)
  }
  const mode = operation.mode ?? (undo.before.kind === 'file' ? undo.before.mode : 0o666)
  chmodSync(target, mode)
}

function applyMove(root, operation, undo, hooks, index) {
  const source = absoluteEndpoint(root, operation.from)
  const destination = absoluteEndpoint(root, operation.to)
  mkdirSync(path.dirname(destination), { recursive: true })
  rmSync(destination, { recursive: true, force: true })
  hooks.afterMoveDestinationRemoval?.({ index })
  renameSync(source, destination)
  if (operation.bytes) {
    applyWrite(
      root,
      { target: operation.to, bytes: operation.bytes, mode: operation.mode },
      { before: undo.sourceBefore },
      hooks,
      index
    )
  }
}

export function applyFilesystemOperation(root, operation, undo, hooks = {}, index = -1) {
  if (operation.kind === 'write') applyWrite(root, operation, undo, hooks, index)
  else if (operation.kind === 'move') applyMove(root, operation, undo, hooks, index)
  else rmSync(absoluteEndpoint(root, operation.target), { recursive: true, force: true })
}
