import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

import { CACHE_MANAGER } from '@nestjs/cache-manager'
import { Inject, Injectable } from '@nestjs/common'
import { AuditActorType, AuditTargetType, type Prisma } from '@prisma/client'
import type { Cache } from 'cache-manager'
import { PinoLogger } from 'nestjs-pino'

import type { ApiKeyListResponse } from '@amcore/shared'
import type { CreateApiKeyInput } from '@amcore/shared'

import { ForbiddenException, NotFoundException } from '../../common/exceptions'
import { PrismaService } from '../../prisma'
import { AuditLogService } from '../audit'

export interface CreateApiKeyResult {
  id: string
  name: string
  key: string
  organizationId: string
  scopes: string[]
  expiresAt: string | null
  createdAt: string
}

export interface ApiKeyListItem {
  id: string
  name: string
  organizationId: string
  scopes: string[]
  expiresAt: string | null
  lastUsedAt: string | null
  createdAt: string
}

@Injectable()
export class ApiKeysService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly auditLog: AuditLogService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(ApiKeysService.name)
  }

  async create(userId: string, input: CreateApiKeyInput): Promise<CreateApiKeyResult> {
    // Per ADR-033: API keys are organization-scoped. Creator must be a
    // member of the bound organization at creation time. Membership is
    // re-verified on each request by ApiKeyGuard (lazy invariant) so a
    // later loss of membership invalidates the credential.
    const { key, shortToken, longToken } = this.generateKey()
    const salt = randomBytes(16).toString('hex')
    const keyHash = this.hashLongToken(longToken, salt)

    const apiKey = await this.prisma.$transaction(async (tx) => {
      const membership = await tx.orgMember.findUnique({
        where: { userId_organizationId: { userId, organizationId: input.organizationId } },
        select: { id: true },
      })

      if (!membership) {
        throw new ForbiddenException('Not a member of the specified organization')
      }

      const created = await tx.apiKey.create({
        data: {
          name: input.name,
          shortToken,
          keyHash,
          salt,
          scopes: input.scopes,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          userId,
          organizationId: input.organizationId,
        },
      })

      await this.auditLog.record(
        {
          action: 'api_key.created',
          actorId: userId,
          actorType: AuditActorType.USER,
          metadata: {
            expiresAt: created.expiresAt?.toISOString() ?? null,
            name: created.name,
            pinoEvent: 'api_key.created',
            scopes: created.scopes,
          },
          organizationId: created.organizationId,
          targetId: created.id,
          targetType: AuditTargetType.API_KEY,
        },
        { tx }
      )

      return created
    })

    this.logger.info(
      { userId, apiKeyId: apiKey.id, organizationId: apiKey.organizationId },
      'API key created'
    )

    return {
      id: apiKey.id,
      name: apiKey.name,
      key,
      organizationId: apiKey.organizationId,
      scopes: apiKey.scopes,
      expiresAt: apiKey.expiresAt?.toISOString() ?? null,
      createdAt: apiKey.createdAt.toISOString(),
    }
  }

  async findAllForUser(userId: string, page: number, limit: number): Promise<ApiKeyListResponse> {
    // ADR-036: paginated envelope. ORDER BY createdAt DESC, id ASC for
    // deterministic page boundaries (createdAt is usually unique but
    // not guaranteed; id tie-break is mandatory).
    const skip = (page - 1) * limit
    const [keys, total] = await Promise.all([
      this.prisma.apiKey.findMany({
        where: { userId },
        skip,
        take: limit,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      }),
      this.prisma.apiKey.count({ where: { userId } }),
    ])

    return {
      data: keys.map((k) => ({
        id: k.id,
        name: k.name,
        organizationId: k.organizationId,
        scopes: k.scopes,
        expiresAt: k.expiresAt?.toISOString() ?? null,
        lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
        createdAt: k.createdAt.toISOString(),
      })),
      total,
      page,
      limit,
    }
  }

  async revoke(id: string, userId: string): Promise<void> {
    const deleted = await this.prisma.$transaction(async (tx) => {
      const apiKey = await tx.apiKey.findUnique({
        where: { id },
        select: { id: true, organizationId: true, userId: true },
      })

      if (!apiKey || apiKey.userId !== userId) {
        throw new NotFoundException('API key')
      }

      const result = await tx.apiKey.deleteMany({
        where: { id, userId },
      })

      await this.auditLog.record(
        {
          action: 'api_key.revoked',
          actorId: userId,
          actorType: AuditActorType.USER,
          metadata: {
            pinoEvent: 'api_key.revoked',
            reason: 'user_revoked',
          },
          organizationId: apiKey.organizationId,
          targetId: id,
          targetType: AuditTargetType.API_KEY,
        },
        { tx }
      )

      return result
    })

    this.logger.info({ userId, apiKeyId: id, deleted: deleted.count }, 'API key revoked')
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

  // AK-12: lastUsedAt is operational metadata and must never make a
  // valid request fail. The caller (`ApiKeyGuard`) intentionally
  // discards the returned promise (`void touchLastUsed(...)`), so any
  // error escaping this method becomes an unhandled rejection. Every
  // I/O is wrapped — cache flakiness or a revoke race only ever
  // produces a warn log, never propagates.
  async touchLastUsed(id: string): Promise<void> {
    const cacheKey = `api_key:last_used:${id}`

    let alreadyUpdated: unknown = false
    try {
      alreadyUpdated = await this.cache.get(cacheKey)
    } catch (err) {
      this.logger.warn(
        { err, apiKeyId: id },
        'Failed to read api_key last_used cache gate (continuing)'
      )
      // Fall through: without the cache gate we'll do one extra DB
      // write per request, but the request itself succeeds.
    }

    if (alreadyUpdated) return

    // Best-effort update. P2025 (record not found) is expected when
    // revoke() races between verify and touch — the existing .catch()
    // swallows it.
    //
    // DO NOT switch to `upsert` here. Upsert would resurrect a revoked
    // key row with the same id, defeating revocation. The race is
    // already safe; keep `update` + tolerant catch.
    void this.prisma.apiKey
      .update({ where: { id }, data: { lastUsedAt: new Date() } })
      .catch((err: unknown) => this.logger.warn({ err }, 'Failed to update lastUsedAt'))

    try {
      await this.cache.set(cacheKey, '1', 3600 * 1000)
    } catch (err) {
      this.logger.warn(
        { err, apiKeyId: id },
        'Failed to set api_key last_used cache gate (continuing)'
      )
    }
  }

  // AK-08: only `live` is supported. A real test/sandbox mode would need
  // data-scope separation (Stripe-style) and is a future feature with its
  // own ADR — until then the prefix is a constant.
  private generateKey(): {
    key: string
    shortToken: string
    longToken: string
  } {
    const shortToken = randomBytes(8).toString('base64url')
    const longToken = randomBytes(24).toString('base64url')
    const key = `amcore_live_${shortToken}_${longToken}`
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
