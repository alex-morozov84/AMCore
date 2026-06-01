import { Injectable } from '@nestjs/common'

import { PrismaService } from '../../prisma'

import { UserCacheService } from './user-cache.service'

import { EnvService } from '@/env/env.service'
import { generateUploadVersion, MediaService } from '@/infrastructure/media'
import { normalizeObjectKey, StorageService } from '@/infrastructure/storage'

/** The validated multer file shape the avatar upload consumes. */
export interface AvatarUploadFile {
  buffer: Buffer
  mimetype: string
}

/** Derivative whose public URL becomes `User.avatarUrl` (the compatibility field). */
const PRIMARY_VARIANT = 'avatar-256'

/**
 * Avatar consumer of the media pipeline. Each upload stores the original
 * privately under a per-upload **versioned** key family
 * (`avatars/<userId>/v-<version>/…`) and generates public WebP derivatives via
 * `MediaService`. The primary derivative's URL is stored in `User.avatarUrl`.
 * Versioned keys let derivatives carry immutable cache headers without
 * stale-on-overwrite; old versions (and the pre-versioning flat object) are
 * swept by prefix after the new version goes live.
 */
@Injectable()
export class AvatarService {
  constructor(
    private readonly storage: StorageService,
    private readonly prisma: PrismaService,
    private readonly userCache: UserCacheService,
    private readonly media: MediaService,
    private readonly env: EnvService
  ) {}

  async setAvatar(userId: string, file: AvatarUploadFile): Promise<string> {
    const version = generateUploadVersion()
    const originalKey = normalizeObjectKey(`avatars/${userId}/v-${version}/original`)
    await this.storage.upload({
      key: originalKey,
      body: file.buffer,
      contentType: file.mimetype,
      visibility: 'private', // originals stay private; only derivatives are public
    })

    const avatarUrl = await this.deriveOrRollback(userId, originalKey, version)
    await this.persistAndSweep(userId, version, avatarUrl)
    return avatarUrl
  }

  async removeAvatar(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatarUrl: true },
    })
    if (!user?.avatarUrl) return // idempotent: nothing to remove

    // Fail closed: clear avatarUrl only after storage cleanup succeeds, so a
    // failed delete never advertises a removed avatar that is still reachable.
    await this.cleanupAvatars(userId)
    await this.prisma.user.update({ where: { id: userId }, data: { avatarUrl: null } })
    await this.userCache.invalidateUser(userId)
  }

  /** Generate derivatives; on any failure best-effort delete the half-written version. */
  private async deriveOrRollback(
    userId: string,
    sourceKey: string,
    version: string
  ): Promise<string> {
    try {
      const result = await this.media.processImageNow({
        sourceKey,
        ownerId: userId,
        preset: 'avatar',
        visibility: 'public-read',
        version,
        cacheControl: this.env.get('MEDIA_AVATAR_CACHE_CONTROL'),
      })
      const primary = result.derivatives.find((d) => d.name === PRIMARY_VARIANT)
      if (!primary?.url) throw new Error('avatar primary derivative produced no public URL')
      return primary.url
    } catch (err) {
      await this.cleanupVersion(userId, version).catch(() => undefined)
      throw err
    }
  }

  /** Persist the URL, invalidate cache, then sweep older versions best-effort. */
  private async persistAndSweep(userId: string, version: string, avatarUrl: string): Promise<void> {
    try {
      await this.prisma.user.update({ where: { id: userId }, data: { avatarUrl } })
    } catch (err) {
      await this.cleanupVersion(userId, version).catch(() => undefined)
      throw err
    }
    // The new avatar is now live. Invalidate the cache so the new URL is served,
    // THEN sweep old versions best-effort — a failed sweep of superseded objects
    // must not fail an upload that already published successfully.
    await this.userCache.invalidateUser(userId)
    await this.cleanupAvatars(userId, version).catch(() => undefined)
  }

  /**
   * Delete every object under `avatars/<userId>/` except `keepVersion` (when
   * given), plus the legacy pre-versioning flat object `avatars/<userId>`.
   */
  private async cleanupAvatars(userId: string, keepVersion?: string): Promise<void> {
    const prefix = `avatars/${userId}/`
    const keepPrefix = keepVersion ? `${prefix}v-${keepVersion}/` : undefined
    const keys = await this.listKeys(prefix)
    keys.push(`avatars/${userId}`) // legacy flat object (no trailing slash; not under prefix)
    const toDelete = keepPrefix ? keys.filter((k) => !k.startsWith(keepPrefix)) : keys
    if (toDelete.length > 0) await this.storage.deleteMany(toDelete)
  }

  private async cleanupVersion(userId: string, version: string): Promise<void> {
    const keys = await this.listKeys(`avatars/${userId}/v-${version}/`)
    if (keys.length > 0) await this.storage.deleteMany(keys)
  }

  private async listKeys(prefix: string): Promise<string[]> {
    const keys: string[] = []
    let continuationToken: string | undefined
    do {
      const page = await this.storage.list({ prefix, continuationToken })
      keys.push(...page.files.map((f) => f.key))
      continuationToken = page.isTruncated ? page.nextToken : undefined
    } while (continuationToken)
    return keys
  }
}
