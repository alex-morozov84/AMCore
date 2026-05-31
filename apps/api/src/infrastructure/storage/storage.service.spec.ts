import { HttpStatus } from '@nestjs/common'

import { AppException } from '../../common/exceptions'

import { MemoryStorageProvider } from './providers/memory-storage.provider'
import type { StorageProvider } from './storage.interface'
import { StorageService } from './storage.service'

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
      service = new StorageService(new MemoryStorageProvider())
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
    const service = new StorageService(new MemoryStorageProvider())

    it('getPublicUrl throws 501 STORAGE_CAPABILITY_UNSUPPORTED', () => {
      const err = thrown(() => service.getPublicUrl('a.txt'))
      expect(err).toBeInstanceOf(AppException)
      expect((err as AppException).getStatus()).toBe(HttpStatus.NOT_IMPLEMENTED)
      expect((err as AppException).errorCode).toBe('STORAGE_CAPABILITY_UNSUPPORTED')
    })

    it('getSignedDownloadUrl throws 501 synchronously', () => {
      const err = thrown(() => service.getSignedDownloadUrl({ key: 'a.txt' }))
      expect(err).toBeInstanceOf(AppException)
      expect((err as AppException).getStatus()).toBe(HttpStatus.NOT_IMPLEMENTED)
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
    const service = new StorageService(provider)

    it('delegates signed + public URL calls without throwing', async () => {
      expect(await service.getSignedDownloadUrl({ key: 'x' })).toBe('signed-download')
      expect(await service.getSignedUploadUrl({ key: 'x' })).toBe('signed-upload')
      expect(service.getPublicUrl('x')).toBe('https://cdn/x')
    })
  })
})
