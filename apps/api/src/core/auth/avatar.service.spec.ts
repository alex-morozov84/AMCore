import type { EnvService } from '../../env/env.service'
import { LockUnavailableError, type RedisMutexService } from '../../infrastructure/redis'
import { PrismaService } from '../../prisma'

import { AvatarService } from './avatar.service'
import { UserCacheService } from './user-cache.service'

import type { MediaService, ProcessImageResult } from '@/infrastructure/media'
import type { StorageService } from '@/infrastructure/storage'

const derivative = (name: string, url: string) => ({
  name,
  key: `avatars/u1/${name}.webp`,
  url,
  width: 256,
  height: 256,
  contentType: 'image/webp',
  size: 10,
})

const PROCESS_RESULT: ProcessImageResult = {
  sourceKey: 'src',
  derivatives: [
    derivative('avatar-128', 'https://cdn/avatar-128.webp'),
    derivative('avatar-256', 'https://cdn/avatar-256.webp'),
    derivative('avatar-512', 'https://cdn/avatar-512.webp'),
  ],
}

describe('AvatarService', () => {
  let service: AvatarService
  let storage: jest.Mocked<Pick<StorageService, 'upload' | 'list' | 'deleteMany'>>
  let prisma: { user: { findUnique: jest.Mock; updateMany: jest.Mock } }
  let userCache: jest.Mocked<Pick<UserCacheService, 'invalidateUser'>>
  let media: jest.Mocked<Pick<MediaService, 'processImageNow'>>
  let env: jest.Mocked<Pick<EnvService, 'get'>>
  let mutex: { runExclusive: jest.Mock }

  beforeEach(() => {
    storage = {
      upload: jest.fn().mockResolvedValue({ key: 'k', size: 1 }),
      list: jest.fn().mockResolvedValue({ files: [], isTruncated: false }),
      deleteMany: jest.fn().mockResolvedValue(undefined),
    }
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ avatarGeneration: 0 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    }
    userCache = { invalidateUser: jest.fn().mockResolvedValue(undefined) }
    media = { processImageNow: jest.fn().mockResolvedValue(PROCESS_RESULT) }
    env = { get: jest.fn().mockReturnValue('public, max-age=31536000, immutable') }
    // The critical section runs inline so the service's own CAS/sweep ordering is
    // what is under test; lock semantics are covered by RedisMutexService's spec.
    mutex = { runExclusive: jest.fn((_key, _opts, fn) => fn()) }
    service = new AvatarService(
      storage as unknown as StorageService,
      prisma as unknown as PrismaService,
      userCache as unknown as UserCacheService,
      media as unknown as MediaService,
      env as unknown as EnvService,
      mutex as unknown as RedisMutexService
    )
  })

  it('stores a private versioned original and CAS-publishes the primary URL', async () => {
    const result = await service.setAvatar('u1', {
      buffer: Buffer.from('img'),
      mimetype: 'image/png',
    })

    expect(storage.upload).toHaveBeenCalledWith(
      expect.objectContaining({
        key: expect.stringMatching(/^avatars\/u1\/v-1-[0-9a-z]+\/original$/) as unknown as string,
        visibility: 'private',
      })
    )
    // Conditional publish: generation 1, only while the stored generation is older.
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'u1', avatarGeneration: { lt: 1 } },
      data: { avatarUrl: 'https://cdn/avatar-256.webp', avatarGeneration: 1 },
    })
    expect(userCache.invalidateUser).toHaveBeenCalledWith('u1')
    expect(result).toBe('https://cdn/avatar-256.webp')
  })

  it('sweeps strictly-older generations and the legacy object, keeping its own', async () => {
    prisma.user.findUnique.mockResolvedValue({ avatarGeneration: 1 }) // → new gen 2
    storage.list.mockResolvedValue({
      files: [
        { key: 'avatars/u1/v-1-old/avatar-256.webp', size: 1 }, // gen 1, superseded
        { key: 'avatars/u1/v-2-new/avatar-256.webp', size: 1 }, // gen 2, our own
      ],
      isTruncated: false,
    })

    await service.setAvatar('u1', { buffer: Buffer.from('img'), mimetype: 'image/png' })

    const deleted = storage.deleteMany.mock.calls.at(-1)?.[0] as string[]
    expect(deleted).toContain('avatars/u1/v-1-old/avatar-256.webp')
    expect(deleted).toContain('avatars/u1') // legacy flat object (generation 0)
    expect(deleted).not.toContain('avatars/u1/v-2-new/avatar-256.webp')
  })

  it('still publishes (and invalidates cache) when the post-publish sweep fails', async () => {
    storage.list.mockResolvedValue({
      files: [{ key: 'avatars/u1/v-0-legacy/avatar-256.webp', size: 1 }],
      isTruncated: false,
    })
    storage.deleteMany.mockRejectedValue(new Error('sweep boom'))

    const result = await service.setAvatar('u1', {
      buffer: Buffer.from('img'),
      mimetype: 'image/png',
    })

    expect(result).toBe('https://cdn/avatar-256.webp')
    expect(prisma.user.updateMany).toHaveBeenCalled()
    expect(userCache.invalidateUser).toHaveBeenCalledWith('u1')
  })

  it('rolls back the new version and does not publish on derive failure', async () => {
    media.processImageNow.mockRejectedValue(new Error('decode boom'))
    storage.list.mockResolvedValue({
      files: [{ key: 'avatars/u1/v-1-x/original', size: 1 }],
      isTruncated: false,
    })

    await expect(
      service.setAvatar('u1', { buffer: Buffer.from('img'), mimetype: 'image/png' })
    ).rejects.toThrow('decode boom')

    expect(prisma.user.updateMany).not.toHaveBeenCalled()
    expect(storage.deleteMany).toHaveBeenCalled() // best-effort version cleanup
  })

  it('fails closed with a retriable 503 when the lock cannot be acquired', async () => {
    mutex.runExclusive.mockRejectedValueOnce(new LockUnavailableError('avatar:lock:u1'))

    await expect(
      service.setAvatar('u1', { buffer: Buffer.from('img'), mimetype: 'image/png' })
    ).rejects.toMatchObject({
      status: 503,
      response: expect.objectContaining({ errorCode: 'AVATAR_LOCKED' }),
    })
  })

  it('runs every mutation under the per-user avatar lock', async () => {
    await service.setAvatar('u1', { buffer: Buffer.from('img'), mimetype: 'image/png' })
    prisma.user.findUnique.mockResolvedValue({ avatarUrl: null, avatarGeneration: 0 })
    await service.removeAvatar('u1')

    expect(mutex.runExclusive).toHaveBeenCalledTimes(2)
    for (const call of mutex.runExclusive.mock.calls) {
      expect(call[0]).toBe('avatar:lock:u1')
    }
  })

  describe('stale-holder interleaving (lease lost; a newer generation won)', () => {
    it('upload: CAS publish matches no row → 503, cleans only its own version, never the newer one', async () => {
      // Holder A read generation 0 → claims generation 1, but generation 2 was
      // already published by a concurrent holder, so A's conditional update misses.
      prisma.user.findUnique.mockResolvedValue({ avatarGeneration: 0 })
      prisma.user.updateMany.mockResolvedValue({ count: 0 })
      storage.list.mockResolvedValue({
        files: [{ key: 'avatars/u1/v-1-mine/original', size: 1 }],
        isTruncated: false,
      })

      await expect(
        service.setAvatar('u1', { buffer: Buffer.from('img'), mimetype: 'image/png' })
      ).rejects.toMatchObject({ status: 503 })

      // CAS used the lt fence (no unconditional overwrite of the newer row).
      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: 'u1', avatarGeneration: { lt: 1 } },
        data: expect.objectContaining({ avatarGeneration: 1 }),
      })
      // Only its own version was cleaned; the sweep (which could reach a newer
      // version) never ran because publish threw first.
      const deleted = storage.deleteMany.mock.calls.flatMap((c) => c[0] as string[])
      expect(deleted.every((k) => k.startsWith('avatars/u1/v-1-mine/'))).toBe(true)
    })

    it('remove: sweep is generation-bounded and never deletes a newer version; CAS miss → 503', async () => {
      // Stale remover read generation 0 → bounds its sweep to generations < 1,
      // while a concurrent upload already published generation 2.
      prisma.user.findUnique.mockResolvedValue({
        avatarUrl: 'https://cdn/avatars/u1/v-0-old/avatar-256.webp',
        avatarGeneration: 0,
      })
      prisma.user.updateMany.mockResolvedValue({ count: 0 }) // newer generation won the CAS
      storage.list.mockResolvedValue({
        files: [
          { key: 'avatars/u1/v-0-old/avatar-256.webp', size: 1 }, // gen 0, sweepable
          { key: 'avatars/u1/v-2-new/avatar-256.webp', size: 1 }, // gen 2, must survive
        ],
        isTruncated: false,
      })

      await expect(service.removeAvatar('u1')).rejects.toMatchObject({ status: 503 })

      const deleted = storage.deleteMany.mock.calls.flatMap((c) => c[0] as string[])
      expect(deleted).toContain('avatars/u1/v-0-old/avatar-256.webp')
      expect(deleted).not.toContain('avatars/u1/v-2-new/avatar-256.webp')
    })
  })

  it('removes all avatar objects and clears the row via CAS', async () => {
    prisma.user.findUnique.mockResolvedValue({
      avatarUrl: 'https://cdn/avatars/u1/v-0-a/avatar-256.webp',
      avatarGeneration: 0,
    })
    storage.list.mockResolvedValue({
      files: [{ key: 'avatars/u1/v-0-a/avatar-256.webp', size: 1 }],
      isTruncated: false,
    })

    await service.removeAvatar('u1')

    const deleted = storage.deleteMany.mock.calls[0]?.[0] as string[]
    expect(deleted).toEqual(['avatars/u1/v-0-a/avatar-256.webp', 'avatars/u1'])
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'u1', avatarGeneration: { lt: 1 } },
      data: { avatarUrl: null, avatarGeneration: 1 },
    })
    expect(userCache.invalidateUser).toHaveBeenCalledWith('u1')
  })

  it('fails closed: does not clear the row when storage cleanup fails', async () => {
    prisma.user.findUnique.mockResolvedValue({
      avatarUrl: 'https://cdn/avatar-256.webp',
      avatarGeneration: 0,
    })
    storage.deleteMany.mockRejectedValue(new Error('storage down'))

    await expect(service.removeAvatar('u1')).rejects.toThrow('storage down')
    expect(prisma.user.updateMany).not.toHaveBeenCalled()
  })

  it('is idempotent when the user has no avatar URL', async () => {
    prisma.user.findUnique.mockResolvedValue({ avatarUrl: null, avatarGeneration: 0 })

    await service.removeAvatar('u1')

    expect(storage.deleteMany).not.toHaveBeenCalled()
    expect(prisma.user.updateMany).not.toHaveBeenCalled()
    expect(userCache.invalidateUser).not.toHaveBeenCalled()
  })
})
