import { ContextRequestError } from './context-errors'

import 'server-only'

/** Count decoded chunks before allocation/parse; Content-Length is not authority. */
export async function readContextJson(
  body: ReadableStream<Uint8Array> | null,
  cap: number
): Promise<unknown> {
  if (!body) throw new ContextRequestError(400, 'BAD_REQUEST')
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      length += next.value.byteLength
      if (length > cap) throw new ContextRequestError(413, 'PAYLOAD_TOO_LARGE')
      chunks.push(next.value)
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  } catch {
    throw new ContextRequestError(400, 'BAD_REQUEST')
  }
}
