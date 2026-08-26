import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { readPngDimensions, EngineError } from './actions.mjs'

/** Fails closed with a concrete message rather than a raw fs/decode error. */
export function validatePngSource(srcPath, expected) {
  if (!existsSync(srcPath)) {
    throw new EngineError(`file not found: ${srcPath}`)
  }
  if (path.extname(srcPath).toLowerCase() !== '.png') {
    throw new EngineError(`expected a .png file, got: ${srcPath}`)
  }
  if (!expected) return
  const { width, height } = readPngDimensions(readFileSync(srcPath))
  if (width !== expected.width || height !== expected.height) {
    throw new EngineError(
      `${srcPath} is ${width}x${height}, expected ${expected.width}x${expected.height} — ` +
        'see apps/web/public/icons/README.md'
    )
  }
}
