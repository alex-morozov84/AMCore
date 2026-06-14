import { Injectable } from '@nestjs/common'

import { ServiceUnavailableException } from '../../common/exceptions'
import {
  LockUnavailableError,
  type MutexOptions,
  RedisMutexService,
} from '../../infrastructure/redis'
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

/** Per-user lock budget — serialization only; correctness is the DB-generation CAS. */
const AVATAR_LOCK: MutexOptions = {
  ttlMs: 10_000,
  renewMs: 3_000,
  attempts: 10,
  retryDelayMs: 200,
}

/**
 * A stale operation lost the generation race (its conditional publish/clear
 * matched no row). Surfaced as a retriable 503 so the client re-attempts.
 */
class StaleAvatarOperationError extends Error {
  constructor() {
    super('Avatar mutation superseded by a newer concurrent operation')
    this.name = 'StaleAvatarOperationError'
  }
}

/**
 * Read the monotonic avatar generation a stored version/key belongs to. The
 * version is rendered `v-<gen>-<rand>`; legacy time-based versions and the
 * pre-versioning flat object have no leading integer and count as generation 0
 * (always superseded, hence sweepable).
 */
function generationOf(urlOrKey: string): number {
  const segment = /\/v-([A-Za-z0-9_-]+)\//.exec(urlOrKey)?.[1]
  if (!segment) return 0
  const gen = Number.parseInt(segment, 10)
  return Number.isNaN(gen) ? 0 : gen
}

/**
 * Avatar consumer of the media pipeline. Each upload stores the original
 * privately under a per-upload **versioned** key family
 * (`avatars/<userId>/v-<gen>-<rand>/…`) and generates public WebP derivatives.
 * The primary derivative's URL is stored in `User.avatarUrl`.
 *
 * Concurrency safety (ADR-049). A per-user Redis lock serializes the common
 * case, but it is only best-effort — a paused holder can lose its lease. The
 * **correctness fence is the monotonic `User.avatarGeneration`**: each operation
 * claims `base + 1` and publishes via a conditional update that only matches
 * when the stored generation is still older. A stale holder therefore cannot
 * publish over a newer version, and because it only ever sweeps versions
 * strictly older than its own generation, it cannot delete a newer one either.
 */
@Injectable()
export class AvatarService {
  constructor(
    private readonly storage: StorageService,
    private readonly prisma: PrismaService,
    private readonly userCache: UserCacheService,
    private readonly media: MediaService,
    private readonly env: EnvService,
    private readonly mutex: RedisMutexService
  ) {}

  async setAvatar(userId: string, file: AvatarUploadFile): Promise<string> {
    return this.withUserLock(userId, async () => {
      const generation = (await this.currentGeneration(userId)) + 1
      const version = `${generation}-${generateUploadVersion()}`
      const originalKey = normalizeObjectKey(`avatars/${userId}/v-${version}/original`)
      await this.storage.upload({
        key: originalKey,
        body: file.buffer,
        contentType: file.mimetype,
        visibility: 'private', // originals stay private; only derivatives are public
      })

      const avatarUrl = await this.deriveOrRollback(userId, originalKey, version)
      await this.publish(userId, generation, version, avatarUrl)
      return avatarUrl
    })
  }

  async removeAvatar(userId: string): Promise<void> {
    await this.withUserLock(userId, async () => {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { avatarUrl: true, avatarGeneration: true },
      })
      if (!user?.avatarUrl) return // idempotent: nothing to remove

      const generation = user.avatarGeneration + 1
      // Fail closed: delete storage before clearing the row, so a failed delete
      // never advertises a removed avatar that is still reachable. The sweep is
      // bounded to generations strictly older than ours, so even a stale remover
      // cannot delete a newer concurrent upload's version.
      await this.sweep(userId, generation)
      // CAS clear: only succeeds if no newer generation has been published.
      const { count } = await this.prisma.user.updateMany({
        where: { id: userId, avatarGeneration: { lt: generation } },
        data: { avatarUrl: null, avatarGeneration: generation },
      })
      if (count === 0) throw new StaleAvatarOperationError()
      await this.userCache.invalidateUser(userId)
    })
  }

  /** Run a per-user critical section under the avatar lock, mapping failures to 503. */
  private async withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await this.mutex.runExclusive(`avatar:lock:${userId}`, AVATAR_LOCK, fn)
    } catch (err) {
      if (err instanceof LockUnavailableError || err instanceof StaleAvatarOperationError) {
        throw new ServiceUnavailableException(
          'Avatar update is busy, please retry shortly',
          'AVATAR_LOCKED'
        )
      }
      throw err
    }
  }

  private async currentGeneration(userId: string): Promise<number> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatarGeneration: true },
    })
    return user?.avatarGeneration ?? 0
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

  /** Conditionally publish the URL (CAS on generation), invalidate cache, then sweep. */
  private async publish(
    userId: string,
    generation: number,
    version: string,
    avatarUrl: string
  ): Promise<void> {
    // CAS fence: matches only while the stored generation is still older, so a
    // stale holder whose lease was reassigned cannot overwrite a newer version.
    const { count } = await this.prisma.user.updateMany({
      where: { id: userId, avatarGeneration: { lt: generation } },
      data: { avatarUrl, avatarGeneration: generation },
    })
    if (count === 0) {
      await this.cleanupVersion(userId, version).catch(() => undefined)
      throw new StaleAvatarOperationError()
    }
    // Live now. Invalidate the cache so the new URL is served, THEN sweep older
    // versions best-effort — a failed sweep of superseded objects must not fail
    // an upload that already published successfully.
    await this.userCache.invalidateUser(userId)
    await this.sweep(userId, generation).catch(() => undefined)
  }

  /**
   * Delete every object under `avatars/<userId>/` whose generation is strictly
   * older than `generation` (plus the legacy flat object `avatars/<userId>`,
   * generation 0). Never touches the operation's own or any newer version, so it
   * is safe even if the caller's lease was lost.
   */
  private async sweep(userId: string, generation: number): Promise<void> {
    const prefix = `avatars/${userId}/`
    const keys = await this.listKeys(prefix)
    keys.push(`avatars/${userId}`) // legacy flat object (no trailing slash; not under prefix)
    const toDelete = keys.filter((k) => generationOf(k) < generation)
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
