import { createWriteStream } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'

/** Decompressed-size guard against a decompression bomb — well above the ~120 MB compressed source. */
const MAX_COMPRESSED_BYTES = 200 * 1024 * 1024
const MAX_DECOMPRESSED_BYTES = 400 * 1024 * 1024
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000

/**
 * DB-IP's free City Lite export follows this predictable monthly URL
 * (verified against DB-IP's own download page 2026-09-26): gzip-compressed
 * MMDB, no authentication. `edition` is `<YYYY>-<MM>` in UTC.
 */
export function buildDbIpDownloadUrl(edition: string): string {
  return `https://download.db-ip.com/free/dbip-city-lite-${edition}.mmdb.gz`
}

/** The UTC calendar-month edition string DB-IP publishes this month. */
export function currentEdition(now: Date = new Date()): string {
  const year = now.getUTCFullYear()
  const month = String(now.getUTCMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

function boundedCounter(maxBytes: number, kind: string): Transform {
  let total = 0
  return new Transform({
    transform(chunk, _enc, callback) {
      total += chunk.length
      if (total > maxBytes) {
        callback(new Error(`GeoIP download exceeded ${maxBytes} ${kind} bytes`))
        return
      }
      callback(null, chunk)
    },
  })
}

/**
 * Streams, decompresses and writes `url` to `destPath` with a bounded
 * timeout and a decompressed-size cap. Throws on any HTTP, timeout, decode
 * or size-limit failure; the caller is responsible for removing a partial
 * `destPath` on failure (see `downloadToFile`'s own cleanup below) and for
 * treating the destination as a *temporary* path — never the live database
 * — until it is independently validated and atomically swapped in.
 */
export async function downloadToFile(url: string, destPath: string): Promise<void> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok || !response.body) {
      throw new Error(`GeoIP download failed: HTTP ${response.status}`)
    }
    if (Number(response.headers.get('content-length')) > MAX_COMPRESSED_BYTES) {
      await response.body.cancel()
      throw new Error('GeoIP compressed Content-Length exceeds the download cap')
    }
    const source = Readable.fromWeb(response.body as never)
    try {
      await pipeline(
        source,
        boundedCounter(MAX_COMPRESSED_BYTES, 'compressed'),
        createGunzip(),
        boundedCounter(MAX_DECOMPRESSED_BYTES, 'decompressed'),
        createWriteStream(destPath),
        { signal: controller.signal }
      )
    } catch (err) {
      await unlink(destPath).catch(() => undefined)
      throw err
    }
  } finally {
    clearTimeout(timeout)
  }
}
