import type { Readable } from 'node:stream'

/**
 * Collect a storage body (`Buffer` or `Readable`) into a single `Buffer`.
 *
 * Shared by the in-memory and (later) local filesystem providers, which need
 * the bytes in hand to store them and compute size/etag. The s3 provider does
 * NOT use this — it streams large bodies straight to the SDK via lib-storage.
 */
export async function bufferFromBody(body: Buffer | Readable): Promise<Buffer> {
  if (Buffer.isBuffer(body)) return body

  const chunks: Buffer[] = []
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string))
  }
  return Buffer.concat(chunks)
}
