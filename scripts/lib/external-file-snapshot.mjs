import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs'

export function readExternalRegularFile(source) {
  const before = lstatSync(source)
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error(
      `asset source must be a regular file, not a symlink or special object: ${source}`
    )
  }
  const descriptor = openSync(source, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = fstatSync(descriptor)
    if (!stat.isFile()) throw new Error(`asset source changed to a non-regular file: ${source}`)
    return Object.freeze({ bytes: Buffer.from(readFileSync(descriptor)), mode: stat.mode & 0o7777 })
  } finally {
    closeSync(descriptor)
  }
}
