import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

import { CACHE_MANAGER } from '@nestjs/cache-manager'
import { Inject, Injectable, Logger } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import type { Cache } from 'cache-manager'

import type { CreateApiKeyInput } from '@amcore/shared'

import { NotFoundException } from '../../common/exceptions'
import { PrismaService } from '../../prisma'

export interface CreateApiKeyResult {
  id: string
  name: string
  key: string
  scopes: string[]
  expiresAt: string | null
  createdAt: string
}

export interface ApiKeyListItem {
  id: string
  name: string
  scopes: string[]
  expiresAt: string | null
  lastUsedAt: string | null
  createdAt: string
}

@Injectable()
export class ApiKeysService {
  private readonly logger = new Logger(ApiKeysService.name)

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache
  ) {}

  async create(userId: string, input: CreateApiKeyInput): Promise<CreateApiKeyResult> {
    const { key, shortToken, longToken } = this.generateKey()
    const salt = randomBytes(16).toString('hex')
    const keyHash = this.hashLongToken(longToken, salt)

    const apiKey = await this.prisma.apiKey.create({
      data: {
        name: input.name,
        shortToken,
        keyHash,
        salt,
        scopes: input.scopes,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        userId,
      },
    })

    this.logger.log('API key created', { userId, apiKeyId: apiKey.id })

    return {
      id: apiKey.id,
      name: apiKey.name,
      key,
      scopes: apiKey.scopes,
      expiresAt: apiKey.expiresAt?.toISOString() ?? null,
      createdAt: apiKey.createdAt.toISOString(),
    }
  }

  async findAllForUser(userId: string): Promise<ApiKeyListItem[]> {
    const keys = await this.prisma.apiKey.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    })

    return keys.map((k) => ({
      id: k.id,
      name: k.name,
      scopes: k.scopes,
      expiresAt: k.expiresAt?.toISOString() ?? null,
      lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
      createdAt: k.createdAt.toISOString(),
    }))
  }

  async revoke(id: string, userId: string): Promise<void> {
    const deleted = await this.prisma.apiKey.deleteMany({
      where: { id, userId },
    })

    if (deleted.count === 0) {
      throw new NotFoundException('API key')
    }

    this.logger.log('API key revoked', { userId, apiKeyId: id })
  }

  async verifyByShortToken(
    shortToken: string,
    longToken: string
  ): Promise<Prisma.ApiKeyGetPayload<{
    include: { user: { select: { systemRole: true } } }
  }> | null> {
    const apiKey = await this.prisma.apiKey.findUnique({
      where: { shortToken },
      include: { user: { select: { systemRole: true } } },
    })

    if (!apiKey) return null
    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) return null
    if (!this.verifyLongToken(longToken, apiKey.keyHash, apiKey.salt)) return null

    return apiKey
  }

  async touchLastUsed(id: string): Promise<void> {
    const cacheKey = `api_key:last_used:${id}`
    const alreadyUpdated = await this.cache.get(cacheKey)

    if (alreadyUpdated) return

    void this.prisma.apiKey
      .update({ where: { id }, data: { lastUsedAt: new Date() } })
      .catch((err: unknown) => this.logger.warn('Failed to update lastUsedAt', { error: err }))

    await this.cache.set(cacheKey, '1', 3600 * 1000)
  }

  private generateKey(env: 'live' | 'test' = 'live'): {
    key: string
    shortToken: string
    longToken: string
  } {
    const shortToken = randomBytes(8).toString('base64url')
    const longToken = randomBytes(24).toString('base64url')
    const key = `amcore_${env}_${shortToken}_${longToken}`
    return { key, shortToken, longToken }
  }

  private hashLongToken(longToken: string, salt: string): string {
    return createHash('sha256')
      .update(longToken + salt)
      .digest('hex')
  }

  private verifyLongToken(longToken: string, storedHash: string, salt: string): boolean {
    const computed = createHash('sha256')
      .update(longToken + salt)
      .digest('hex')
    return timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(storedHash, 'hex'))
  }
}
