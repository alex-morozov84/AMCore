import { Injectable } from '@nestjs/common'

import type { AdminApiKeyListResponse, AdminApiKeyQuery } from '@amcore/shared'

import { PrismaService } from '../../prisma'
import { apiKeyStatus, apiKeyStatusWhere } from '../api-keys/api-key-lifecycle'
import { AuditLogService } from '../audit'

import { AuditActorType, Prisma } from '@/generated/prisma/client'

/** Cross-platform metadata only; verifier columns never enter the projection. */
@Injectable()
export class AdminApiKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService
  ) {}

  async list(query: AdminApiKeyQuery, actorId: string): Promise<AdminApiKeyListResponse> {
    const now = new Date()
    const where = this.where(query, now)
    const direction = query.sortOrder ?? (query.sortBy === 'name' ? 'asc' : 'desc')
    const nullable = ['expiresAt', 'lastUsedAt', 'revokedAt'].includes(query.sortBy)
    const orderBy: Prisma.ApiKeyOrderByWithRelationInput[] = [
      { [query.sortBy]: nullable ? { sort: direction, nulls: 'last' } : direction },
      { id: direction },
    ]
    const [rows, total] = await this.prisma.$transaction(
      [
        this.prisma.apiKey.findMany({
          where,
          orderBy,
          skip: (query.page - 1) * query.limit,
          take: query.limit,
          select: {
            id: true,
            name: true,
            scopes: true,
            createdAt: true,
            expiresAt: true,
            lastUsedAt: true,
            revokedAt: true,
            revocationReason: true,
            user: { select: { id: true, name: true, email: true } },
            organization: { select: { id: true, name: true, slug: true } },
          },
        }),
        this.prisma.apiKey.count({ where }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
    )
    await this.audit.record(
      {
        action: 'admin.api_keys.viewed',
        actorId,
        actorType: AuditActorType.USER,
        metadata: {
          search: Boolean(query.search),
          user: Boolean(query.userId),
          organization: Boolean(query.organizationId),
          id: Boolean(query.id),
          status: query.status !== 'all',
          resultCount: rows.length,
        },
      },
      { failOpen: false }
    )
    return {
      data: rows.map(({ user, ...row }) => ({
        ...row,
        owner: user,
        status: apiKeyStatus(row, now),
        createdAt: row.createdAt.toISOString(),
        expiresAt: row.expiresAt?.toISOString() ?? null,
        lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
        revokedAt: row.revokedAt?.toISOString() ?? null,
        revocationReason: row.revocationReason as 'owner_revoked' | 'platform_revoked' | null,
      })),
      total,
      page: query.page,
      limit: query.limit,
    }
  }

  private where(query: AdminApiKeyQuery, now: Date): Prisma.ApiKeyWhereInput {
    const state = apiKeyStatusWhere(query.status, now)
    // Prisma LIKE needs literal wildcard escaping, matching existing discovery semantics.
    const literal = query.search?.replace(/[\\%_]/g, '\\$&')
    return {
      ...state,
      id: query.id,
      userId: query.userId,
      organizationId: query.organizationId,
      ...(literal ? { name: { contains: literal, mode: 'insensitive' } } : {}),
    }
  }
}
