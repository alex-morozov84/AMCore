import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { normalizeRelativePath } from './path-algebra-normalize.mjs'

export function legacyEndpoint(root, absolute, label) {
  if (typeof absolute !== 'string' || !path.isAbsolute(absolute)) {
    throw new Error(`${label} must be an absolute legacy path`)
  }
  const relative = path.relative(path.resolve(root), path.resolve(absolute))
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes the transaction root: ${absolute}`)
  }
  return normalizeRelativePath(relative)
}

export function readExternalRegularFile(source) {
  const before = lstatSync(source)
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error(
      `copy source must be a regular file, not a symlink or special object: ${source}`
    )
  }
  const descriptor = openSync(source, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = fstatSync(descriptor)
    if (!stat.isFile()) throw new Error(`copy source changed to a non-regular file: ${source}`)
    return { bytes: Buffer.from(readFileSync(descriptor)), mode: stat.mode & 0o7777 }
  } finally {
    closeSync(descriptor)
  }
}

export function legacyCreatedFileMode(target) {
  try {
    const stat = lstatSync(target)
    if (!stat.isFile()) throw new Error(`rewrite destination must be a regular file: ${target}`)
    return stat.mode & 0o7777
  } catch (error) {
    if (error.code === 'ENOENT') return 0o666 & ~process.umask()
    throw error
  }
}
