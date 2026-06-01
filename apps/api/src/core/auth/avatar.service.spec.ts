import type { EnvService } from '../../env/env.service'
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
  let prisma: { user: { findUnique: jest.Mock; update: jest.Mock } }
  let userCache: jest.Mocked<Pick<UserCacheService, 'invalidateUser'>>
  let media: jest.Mocked<Pick<MediaService, 'processImageNow'>>
  let env: jest.Mocked<Pick<EnvService, 'get'>>

  beforeEach(() => {
    storage = {
      upload: jest.fn().mockResolvedValue({ key: 'k', size: 1 }),
      list: jest.fn().mockResolvedValue({ files: [], isTruncated: false }),
      deleteMany: jest.fn().mockResolvedValue(undefined),
    }
    prisma = { user: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) } }
    userCache = { invalidateUser: jest.fn().mockResolvedValue(undefined) }
    media = { processImageNow: jest.fn().mockResolvedValue(PROCESS_RESULT) }
    env = { get: jest.fn().mockReturnValue('public, max-age=31536000, immutable') }
    service = new AvatarService(
      storage as unknown as StorageService,
      prisma as unknown as PrismaService,
      userCache as unknown as UserCacheService,
      media as unknown as MediaService,
      env as unknown as EnvService
    )
  })

  it('stores a private versioned original, derives, and persists the primary URL', async () => {
    const result = await service.setAvatar('u1', {
      buffer: Buffer.from('img'),
      mimetype: 'image/png',
    })

    expect(storage.upload).toHaveBeenCalledWith(
      expect.objectContaining({
        key: expect.stringMatching(/^avatars\/u1\/v-[0-9a-z]+\/original$/) as unknown as string,
        contentType: 'image/png',
        visibility: 'private',
      })
    )
    expect(media.processImageNow).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: 'u1',
        preset: 'avatar',
        visibility: 'public-read',
        cacheControl: 'public, max-age=31536000, immutable',
        version: expect.any(String) as unknown as string,
      })
    )
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { avatarUrl: 'https://cdn/avatar-256.webp' },
    })
    expect(userCache.invalidateUser).toHaveBeenCalledWith('u1')
    expect(result).toBe('https://cdn/avatar-256.webp')
  })

  it('sweeps old versions and the legacy flat object, keeping the new version', async () => {
    storage.list.mockResolvedValue({
      files: [{ key: 'avatars/u1/v-old/avatar-256.webp', size: 1 }],
      isTruncated: false,
    })

    await service.setAvatar('u1', { buffer: Buffer.from('img'), mimetype: 'image/png' })

    const deleted = storage.deleteMany.mock.calls.at(-1)?.[0] as string[]
    expect(deleted).toContain('avatars/u1/v-old/avatar-256.webp')
    expect(deleted).toContain('avatars/u1') // legacy flat object
  })

  it('still publishes (and invalidates cache) when post-publish sweep fails', async () => {
    storage.list.mockResolvedValue({
      files: [{ key: 'avatars/u1/v-old/avatar-256.webp', size: 1 }],
      isTruncated: false,
    })
    storage.deleteMany.mockRejectedValue(new Error('sweep boom'))

    const result = await service.setAvatar('u1', {
      buffer: Buffer.from('img'),
      mimetype: 'image/png',
    })

    expect(result).toBe('https://cdn/avatar-256.webp')
    expect(prisma.user.update).toHaveBeenCalled()
    expect(userCache.invalidateUser).toHaveBeenCalledWith('u1')
  })

  it('rolls back the new version and does not persist on derive failure', async () => {
    media.processImageNow.mockRejectedValue(new Error('decode boom'))
    storage.list.mockResolvedValue({
      files: [{ key: 'avatars/u1/v-x/original', size: 1 }],
      isTruncated: false,
    })

    await expect(
      service.setAvatar('u1', { buffer: Buffer.from('img'), mimetype: 'image/png' })
    ).rejects.toThrow('decode boom')

    expect(prisma.user.update).not.toHaveBeenCalled()
    expect(storage.deleteMany).toHaveBeenCalled() // best-effort version cleanup
  })

  it('removes all avatar objects and clears avatarUrl', async () => {
    prisma.user.findUnique.mockResolvedValue({ avatarUrl: 'https://cdn/avatar-256.webp' })
    storage.list.mockResolvedValue({
      files: [{ key: 'avatars/u1/v-a/avatar-256.webp', size: 1 }],
      isTruncated: false,
    })

    await service.removeAvatar('u1')

    const deleted = storage.deleteMany.mock.calls[0]?.[0] as string[]
    expect(deleted).toEqual(['avatars/u1/v-a/avatar-256.webp', 'avatars/u1'])
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { avatarUrl: null },
    })
    expect(userCache.invalidateUser).toHaveBeenCalledWith('u1')
  })

  it('fails closed: does not clear avatarUrl when storage cleanup fails', async () => {
    prisma.user.findUnique.mockResolvedValue({ avatarUrl: 'https://cdn/avatar-256.webp' })
    storage.deleteMany.mockRejectedValue(new Error('storage down'))

    await expect(service.removeAvatar('u1')).rejects.toThrow('storage down')
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it('is idempotent when the user has no avatar URL', async () => {
    prisma.user.findUnique.mockResolvedValue({ avatarUrl: null })

    await service.removeAvatar('u1')

    expect(storage.deleteMany).not.toHaveBeenCalled()
    expect(prisma.user.update).not.toHaveBeenCalled()
    expect(userCache.invalidateUser).not.toHaveBeenCalled()
  })
})
