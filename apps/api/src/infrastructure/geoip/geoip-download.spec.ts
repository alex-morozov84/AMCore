import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

import { buildDbIpDownloadUrl, currentEdition, downloadToFile } from './geoip-download'

describe('buildDbIpDownloadUrl', () => {
  it('follows DB-IP City Lite’s documented monthly URL pattern', () => {
    expect(buildDbIpDownloadUrl('2026-09')).toBe(
      'https://download.db-ip.com/free/dbip-city-lite-2026-09.mmdb.gz'
    )
  })
})

describe('currentEdition', () => {
  it('formats the UTC calendar month as YYYY-MM', () => {
    expect(currentEdition(new Date('2026-01-05T23:00:00.000Z'))).toBe('2026-01')
    expect(currentEdition(new Date('2026-09-26T12:00:00.000Z'))).toBe('2026-09')
    expect(currentEdition(new Date('2026-12-31T23:59:59.000Z'))).toBe('2026-12')
  })
})

describe('downloadToFile', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'geoip-download-test-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
    jest.restoreAllMocks()
  })

  it('streams, gunzips and writes the response body to destPath', async () => {
    const payload = Buffer.from('fake mmdb bytes for this test')
    const gz = gzipSync(payload)
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(gz)
        controller.close()
      },
    })
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 200 }) as never)

    const dest = join(dir, 'out.mmdb')
    await downloadToFile('https://example.test/db.mmdb.gz', dest)

    expect(await readFile(dest)).toEqual(payload)
  })

  it('throws and does not leave a partial file on a non-2xx response', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 404 }) as never)

    const dest = join(dir, 'out.mmdb')
    await expect(downloadToFile('https://example.test/missing.gz', dest)).rejects.toThrow(
      /HTTP 404/
    )
    await expect(readFile(dest)).rejects.toThrow()
  })

  it('throws and removes a partial file when the gzip stream is corrupt', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Buffer.from('not actually gzip'))
        controller.close()
      },
    })
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 200 }) as never)

    const dest = join(dir, 'out.mmdb')
    await expect(downloadToFile('https://example.test/db.mmdb.gz', dest)).rejects.toThrow()
    await expect(readFile(dest)).rejects.toThrow()
  })
  it('rejects oversized compressed Content-Length before allocating/decompressing it', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('not consumed', {
        headers: { 'content-length': String(201 * 1024 * 1024) },
      })
    )
    const dest = join(dir, 'over.mmdb')
    await expect(downloadToFile('https://example.test/over.gz', dest)).rejects.toThrow(
      /compressed Content-Length/
    )
    await expect(readFile(dest)).rejects.toThrow()
  })

  it('aborts a stalled fetch at its five-minute deadline', async () => {
    jest.useFakeTimers()
    jest.spyOn(globalThis, 'fetch').mockImplementation(
      async (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        })
    )
    try {
      const promise = downloadToFile('https://example.test/stalled.gz', join(dir, 'stalled'))
      const rejection = promise.catch((error: unknown) => error)
      await jest.advanceTimersByTimeAsync(5 * 60 * 1000)
      expect(await rejection).toEqual(new Error('aborted'))
    } finally {
      jest.useRealTimers()
    }
  })

  it('bounds decompression and removes a partial file for a gzip bomb', async () => {
    const member = gzipSync(Buffer.alloc(64 * 1024))
    let count = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (count++ < 6500) controller.enqueue(member)
        else controller.close()
      },
    })
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body))
    const dest = join(dir, 'bomb.mmdb')
    await expect(downloadToFile('https://example.test/bomb.gz', dest)).rejects.toThrow(
      /decompressed bytes/
    )
    await expect(readFile(dest)).rejects.toThrow()
  }, 15000)
})
