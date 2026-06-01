import { Readable } from 'node:stream'

import { StreamableFile } from '@nestjs/common'
import type { Response } from 'express'

import { AppException, BadRequestException, NotFoundException } from '../../common/exceptions'

import { type FileMetadata, StorageObjectNotFoundError } from './storage.interface'
import type { StorageService } from './storage.service'
import { StorageDownloadService } from './storage-download.service'

const META: FileMetadata = {
  contentType: 'image/png',
  contentLength: 12,
  etag: 'abc123',
  lastModified: new Date('2026-05-31T10:00:00Z'),
  visibility: 'private',
}

function makeRes(): Response & { headers: Record<string, string> } {
  const headers: Record<string, string> = {}
  return {
    headers,
    setHeader: jest.fn((name: string, value: string) => {
      headers[name] = value
    }),
  } as unknown as Response & { headers: Record<string, string> }
}

describe('StorageDownloadService', () => {
  let storage: { getMetadata: jest.Mock; downloadStream: jest.Mock }
  let service: StorageDownloadService

  beforeEach(() => {
    storage = {
      getMetadata: jest.fn().mockResolvedValue(META),
      downloadStream: jest.fn().mockResolvedValue(Readable.from(Buffer.from('hello'))),
    }
    service = new StorageDownloadService(storage as unknown as StorageService)
  })

  it('streams the object as an attachment with safe headers', async () => {
    const res = makeRes()
    const result = await service.streamObject('docs/a.png', res)

    expect(storage.getMetadata).toHaveBeenCalledWith('docs/a.png')
    expect(storage.downloadStream).toHaveBeenCalledWith('docs/a.png')
    expect(result).toBeInstanceOf(StreamableFile)
    expect(result.getHeaders()).toMatchObject({
      type: 'image/png',
      disposition: 'attachment',
      length: 12,
    })
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff')
    expect(res.headers['ETag']).toBe('abc123')
    expect(res.headers['Last-Modified']).toBe(META.lastModified?.toUTCString())
  })

  it('does not preflight with exists() — only HEAD + GET', async () => {
    await service.streamObject('docs/a.png', makeRes())
    expect(storage).not.toHaveProperty('exists')
    expect(storage.getMetadata).toHaveBeenCalledTimes(1)
    expect(storage.downloadStream).toHaveBeenCalledTimes(1)
  })

  it('falls back to application/octet-stream when content type is unknown', async () => {
    storage.getMetadata.mockResolvedValue({ contentLength: 3 } satisfies FileMetadata)
    const result = await service.streamObject('x.bin', makeRes())
    expect(result.getHeaders().type).toBe('application/octet-stream')
  })

  it('downgrades unsafe inline types (svg/html) to octet-stream', async () => {
    for (const type of ['image/svg+xml', 'text/html']) {
      storage.getMetadata.mockResolvedValue({ contentType: type, contentLength: 1 })
      const result = await service.streamObject('evil', makeRes())
      expect(result.getHeaders().type).toBe('application/octet-stream')
    }
  })

  it('maps a typed not-found to 404 (no exists preflight, no race)', async () => {
    storage.getMetadata.mockRejectedValue(new StorageObjectNotFoundError('docs/missing.txt'))
    await expect(service.streamObject('docs/missing.txt', makeRes())).rejects.toBeInstanceOf(
      NotFoundException
    )
  })

  it('maps a not-found that surfaces only at stream time to 404', async () => {
    storage.downloadStream.mockRejectedValue(new StorageObjectNotFoundError('docs/raced.txt'))
    await expect(service.streamObject('docs/raced.txt', makeRes())).rejects.toBeInstanceOf(
      NotFoundException
    )
  })

  it('returns 400 for a traversal / invalid key', async () => {
    await expect(service.streamObject('../etc/passwd', makeRes())).rejects.toBeInstanceOf(
      BadRequestException
    )
    expect(storage.getMetadata).not.toHaveBeenCalled()
  })

  it('maps provider/FS faults to a generic 500 without leaking the message', async () => {
    storage.getMetadata.mockRejectedValue(new Error('EACCES: /var/secret/path denied'))
    const err = await service.streamObject('x.txt', makeRes()).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AppException)
    expect((err as AppException).getStatus()).toBe(500)
    expect((err as AppException).message).toBe('Storage download failed')
    expect((err as AppException).message).not.toContain('EACCES')
  })
})
