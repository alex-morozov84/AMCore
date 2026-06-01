import { PrismaService } from '../../prisma'

import { AvatarService } from './avatar.service'
import { UserCacheService } from './user-cache.service'

import { StorageService } from '@/infrastructure/storage'

describe('AvatarService', () => {
  let service: AvatarService
  let storage: jest.Mocked<Pick<StorageService, 'upload' | 'getPublicUrl' | 'delete'>>
  let prisma: {
    user: {
      findUnique: jest.Mock
      update: jest.Mock
    }
  }
  let userCache: jest.Mocked<Pick<UserCacheService, 'invalidateUser'>>

  beforeEach(() => {
    storage = {
      upload: jest.fn(),
      getPublicUrl: jest.fn(),
      delete: jest.fn(),
    }
    prisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    }
    userCache = {
      invalidateUser: jest.fn(),
    }
    service = new AvatarService(
      storage as unknown as StorageService,
      prisma as unknown as PrismaService,
      userCache as unknown as UserCacheService
    )
  })

  it('uploads a public avatar to the stable user-scoped key and stores the public URL', async () => {
    storage.upload.mockResolvedValue({
      key: 'avatars/user-123',
      size: 12,
      contentType: 'image/png',
    })
    storage.getPublicUrl.mockReturnValue('https://cdn.example.test/avatars/user-123')
    prisma.user.update.mockResolvedValue({})
    userCache.invalidateUser.mockResolvedValue()

    const result = await service.setAvatar('user-123', {
      buffer: Buffer.from('avatar-bytes'),
      mimetype: 'image/png',
    })

    expect(storage.upload).toHaveBeenCalledWith({
      key: 'avatars/user-123',
      body: Buffer.from('avatar-bytes'),
      contentType: 'image/png',
      cacheControl: 'public, max-age=31536000',
      visibility: 'public-read',
    })
    expect(storage.getPublicUrl).toHaveBeenCalledWith('avatars/user-123')
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-123' },
      data: { avatarUrl: 'https://cdn.example.test/avatars/user-123' },
    })
    expect(userCache.invalidateUser).toHaveBeenCalledWith('user-123')
    expect(result).toBe('https://cdn.example.test/avatars/user-123')
  })

  it('deletes the stable avatar object and clears avatarUrl when one is set', async () => {
    prisma.user.findUnique.mockResolvedValue({
      avatarUrl: 'https://cdn.example.test/avatars/user-123',
    })
    storage.delete.mockResolvedValue()
    prisma.user.update.mockResolvedValue({})
    userCache.invalidateUser.mockResolvedValue()

    await service.removeAvatar('user-123')

    expect(storage.delete).toHaveBeenCalledWith('avatars/user-123')
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-123' },
      data: { avatarUrl: null },
    })
    expect(userCache.invalidateUser).toHaveBeenCalledWith('user-123')
  })

  it('is idempotent when the user has no avatar URL', async () => {
    prisma.user.findUnique.mockResolvedValue({ avatarUrl: null })

    await service.removeAvatar('user-123')

    expect(storage.delete).not.toHaveBeenCalled()
    expect(prisma.user.update).not.toHaveBeenCalled()
    expect(userCache.invalidateUser).not.toHaveBeenCalled()
  })
})
