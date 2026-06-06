import { HttpStatus } from '@nestjs/common'

import { AppException } from '../../common/exceptions'

import { MemoryStorageProvider } from './providers/memory-storage.provider'
import type { StorageProvider } from './storage.interface'
import { StorageService } from './storage.service'

import type { EnvService } from '@/env/env.service'
import type { MetricsService } from '@/infrastructure/observability'

const makeService = (provider: StorageProvider) => {
  const env = { get: jest.fn().mockReturnValue('memory') } as unknown as EnvService
  const metrics = {
    observeStorageOperation: jest.fn(),
  } as unknown as jest.Mocked<MetricsService>
  return { service: new StorageService(provider, env, metrics), metrics }
}

function thrown(fn: () => unknown): unknown {
  try {
    fn()
  } catch (error) {
    return error
  }
  return undefined
}

describe('StorageService', () => {
  describe('delegation to the active provider (memory)', () => {
    let service: StorageService

    beforeEach(() => {
      service = makeService(new MemoryStorageProvider()).service
    })

    it('delegates upload + download', async () => {
      const result = await service.upload({ key: 'a.txt', body: Buffer.from('hi') })
      expect(result.key).toBe('a.txt')
      expect((await service.download('a.txt')).toString()).toBe('hi')
    })

    it('exposes the provider capabilities', () => {
      expect(service.capabilities).toEqual({ signedUrls: false, publicUrls: false })
    })
  })

  describe('capability fail-fast (driver without signed/public URLs)', () => {
    const { service, metrics } = makeService(new MemoryStorageProvider())

    it('getPublicUrl throws 501 STORAGE_CAPABILITY_UNSUPPORTED', () => {
      const err = thrown(() => service.getPublicUrl('a.txt'))
      expect(err).toBeInstanceOf(AppException)
      expect((err as AppException).getStatus()).toBe(HttpStatus.NOT_IMPLEMENTED)
      expect((err as AppException).errorCode).toBe('STORAGE_CAPABILITY_UNSUPPORTED')
    })

    it('getSignedDownloadUrl throws 501 synchronously and records the error', () => {
      const err = thrown(() => service.getSignedDownloadUrl({ key: 'a.txt' }))
      expect(err).toBeInstanceOf(AppException)
      expect((err as AppException).getStatus()).toBe(HttpStatus.NOT_IMPLEMENTED)
      expect(metrics.observeStorageOperation).toHaveBeenCalledWith(
        'memory',
        'signed_download_url',
        'error',
        expect.any(Number)
      )
    })

    it('getSignedUploadUrl throws 501 synchronously', () => {
      const err = thrown(() => service.getSignedUploadUrl({ key: 'a.txt' }))
      expect(err).toBeInstanceOf(AppException)
    })
  })

  describe('delegation when the driver supports URLs', () => {
    const provider = {
      capabilities: { signedUrls: true, publicUrls: true },
      getSignedDownloadUrl: jest.fn().mockResolvedValue('signed-download'),
      getSignedUploadUrl: jest.fn().mockResolvedValue('signed-upload'),
      getPublicUrl: jest.fn().mockReturnValue('https://cdn/x'),
    } as unknown as StorageProvider
    const { service, metrics } = makeService(provider)

    it('delegates signed + public URL calls without throwing', async () => {
      expect(await service.getSignedDownloadUrl({ key: 'x' })).toBe('signed-download')
      expect(await service.getSignedUploadUrl({ key: 'x' })).toBe('signed-upload')
      expect(service.getPublicUrl('x')).toBe('https://cdn/x')
      expect(metrics.observeStorageOperation).toHaveBeenCalledWith(
        'memory',
        'signed_download_url',
        'success',
        expect.any(Number)
      )
      expect(metrics.observeStorageOperation).not.toHaveBeenCalledWith(
        'memory',
        'get_public_url',
        expect.anything(),
        expect.anything()
      )
    })
  })

  it('records provider errors without exposing object keys as labels', async () => {
    const provider = {
      capabilities: { signedUrls: false, publicUrls: false },
      upload: jest.fn().mockRejectedValue(new Error('storage down')),
    } as unknown as StorageProvider
    const { service, metrics } = makeService(provider)

    await expect(
      service.upload({ key: 'secret/object-key', body: Buffer.from('x') })
    ).rejects.toThrow('storage down')

    expect(metrics.observeStorageOperation).toHaveBeenCalledWith(
      'memory',
      'upload',
      'error',
      expect.any(Number)
    )
  })
})
