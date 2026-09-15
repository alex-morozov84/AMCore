import { lstatSync, realpathSync } from 'node:fs'
import path from 'node:path'

import { normalizeRelativePath } from './path-algebra-normalize.mjs'
import { FilesystemTransactionError, TRANSACTION_CODES } from './filesystem-transaction-errors.mjs'

function invalidShape(detail, paths = []) {
  throw new FilesystemTransactionError(TRANSACTION_CODES.INVALID_SHAPE, detail, { paths })
}

export function resolveTransactionRoot(rawRoot) {
  const absolute = path.resolve(rawRoot)
  let stat
  try {
    stat = lstatSync(absolute)
  } catch (error) {
    invalidShape(`transaction root cannot be inspected: ${error.message}`)
  }
  if (stat.isSymbolicLink()) invalidShape('transaction root must not be a symlink')
  if (!stat.isDirectory()) invalidShape('transaction root must be a directory')
  return realpathSync(absolute)
}

export function normalizeEndpoint(rawPath) {
  return normalizeRelativePath(rawPath)
}

export function absoluteEndpoint(root, relative) {
  return path.join(root, ...relative.split('/'))
}

function lstatOrMissing(absolute) {
  try {
    return lstatSync(absolute)
  } catch (error) {
    if (error.code === 'ENOENT') return undefined
    throw error
  }
}

export function inspectParents(root, relative) {
  const segments = relative.split('/').slice(0, -1)
  const missing = []
  let current = root
  for (const segment of segments) {
    current = path.join(current, segment)
    const stat = lstatOrMissing(current)
    if (!stat) missing.push(current)
    else if (stat.isSymbolicLink()) invalidShape(`symlink ancestor is not allowed: ${current}`)
    else if (!stat.isDirectory()) invalidShape(`non-directory ancestor is not allowed: ${current}`)
  }
  return missing
}
