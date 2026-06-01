import { Injectable } from '@nestjs/common'

import { PrismaService } from '../../prisma'

import { UserCacheService } from './user-cache.service'

import { normalizeObjectKey, StorageService } from '@/infrastructure/storage'

/** The validated multer file shape the avatar upload consumes. */
export interface AvatarUploadFile {
  buffer: Buffer
  mimetype: string
}

/**
 * Avatar consumer — the one explicit `public-read` opt-in over the otherwise
 * private-by-default storage (STORAGE_PLAN.md Decision A). The object key is
 * stable and user-scoped (`avatars/<userId>`), so re-uploads overwrite in place
 * and the cached, long-lived public URL stays valid. The public URL is stored in
 * the existing `User.avatarUrl`.
 */
@Injectable()
export class AvatarService {
  constructor(
    private readonly storage: StorageService,
    private readonly prisma: PrismaService,
    private readonly userCache: UserCacheService
  ) {}

  async setAvatar(userId: string, file: AvatarUploadFile): Promise<string> {
    const key = normalizeObjectKey(`avatars/${userId}`)
    await this.storage.upload({
      key,
      body: file.buffer,
      contentType: file.mimetype,
      cacheControl: 'public, max-age=31536000', // stable per-user key
      visibility: 'public-read', // explicit opt-in (Decision A)
    })
    const avatarUrl = this.storage.getPublicUrl(key)
    await this.prisma.user.update({ where: { id: userId }, data: { avatarUrl } })
    await this.userCache.invalidateUser(userId)
    return avatarUrl
  }

  async removeAvatar(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatarUrl: true },
    })
    if (!user?.avatarUrl) return // idempotent: nothing to remove

    await this.storage.delete(normalizeObjectKey(`avatars/${userId}`))
    await this.prisma.user.update({ where: { id: userId }, data: { avatarUrl: null } })
    await this.userCache.invalidateUser(userId)
  }
}
