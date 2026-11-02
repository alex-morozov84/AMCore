import { createHmac } from 'node:crypto'
import { chmod, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { directory } from './state.mjs'

// One-time codes for the demo operator of a disposable preview stand (RFC 6238: HMAC-SHA1,
// 30-second steps, six digits - the settings the app's enrollment screen uses). Written here
// instead of pulling a library into the stand tooling.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const STEP_SECONDS = 30

export function base32Decode(text) {
  const clean = text.replace(/[\s=-]/g, '').toUpperCase()
  let bits = ''
  for (const char of clean) {
    const value = ALPHABET.indexOf(char)
    if (value < 0) throw new Error('Operator secret is not base32')
    bits += value.toString(2).padStart(5, '0')
  }
  const bytes = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(bytes)
}

/** The current code and how many whole seconds it stays valid. */
export function totp(secret, nowMs = Date.now()) {
  const counter = Math.floor(nowMs / 1000 / STEP_SECONDS)
  const message = Buffer.alloc(8)
  message.writeBigUInt64BE(BigInt(counter))
  const hash = createHmac('sha1', base32Decode(secret)).update(message).digest()
  const offset = hash[hash.length - 1] & 0x0f
  const binary = hash.readUInt32BE(offset) & 0x7fffffff
  return {
    code: String(binary % 1_000_000).padStart(6, '0'),
    secondsLeft: STEP_SECONDS - (Math.floor(nowMs / 1000) % STEP_SECONDS),
  }
}

/** Owner-only file inside the stand's own directory; never printed, only used to make codes. */
export const factorFile = (m) => join(directory(m.id), 'operator-factor.json')

export async function saveFactor(m, factor) {
  const file = factorFile(m)
  await writeFile(file, `${JSON.stringify(factor)}\n`, { mode: 0o600 })
  await chmod(file, 0o600)
}

export async function loadFactor(m) {
  try {
    return JSON.parse(await readFile(factorFile(m), 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return undefined
    throw error
  }
}
