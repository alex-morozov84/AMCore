import { TELEGRAM_MAX_RESPONSE_BYTES } from './telegram.constants.js'

export type BoundedBody = { text: string } | { error: 'oversize' | 'stream' }

/**
 * Read the body with a true **byte** ceiling. Rejects an honest oversize `content-length` before
 * reading, then streams `response.body` counting `Uint8Array.byteLength` per chunk and **cancels
 * early** the moment the cumulative bytes exceed the ceiling — so a chunked, compressed (fetch
 * decompresses), or multibyte body cannot bypass it (UTF-16 `String.length` would). Reports why
 * nothing was read: an oversize body and a broken stream are different answers to a caller that
 * classifies them.
 */
export async function readBoundedBody(response: Response): Promise<BoundedBody> {
  const declared = Number(response.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > TELEGRAM_MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined)
    return { error: 'oversize' }
  }
  if (!response.body) {
    const text = await response.text().catch(() => undefined)
    if (text === undefined) return { error: 'stream' }
    return Buffer.byteLength(text, 'utf8') > TELEGRAM_MAX_RESPONSE_BYTES
      ? { error: 'oversize' }
      : { text }
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done || value === undefined) break
      total += value.byteLength
      if (total > TELEGRAM_MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined)
        return { error: 'oversize' }
      }
      chunks.push(value)
    }
  } catch {
    return { error: 'stream' }
  }
  return { text: Buffer.concat(chunks).toString('utf8') }
}
