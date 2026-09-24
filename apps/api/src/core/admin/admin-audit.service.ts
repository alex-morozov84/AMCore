import { Injectable } from '@nestjs/common'

import type { AdminAuditQuery, AdminAuditResponse, RequestPrincipal } from '@amcore/shared'

import { BadRequestException } from '../../common/exceptions'
import { EnvService } from '../../env/env.service'
import { PrismaService } from '../../prisma'
import { AuditLogService } from '../audit'

import { AuditCursorCodec } from './audit-cursor'
import { projectAuditRow, safeAuditId } from './audit-projection'

import { AuditActorType, AuditCategory, type Prisma } from '@/generated/prisma/client'

const SELECT = {
  id: true,
  cursorKey: true,
  createdAt: true,
  actorType: true,
  actorId: true,
  action: true,
  targetType: true,
  targetId: true,
  organizationId: true,
  category: true,
  metadata: true,
} as const satisfies Prisma.AuditLogSelect

const MAX_WINDOW_MS = 31 * 24 * 60 * 60 * 1_000
const DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000

function effectiveWindow(query: AdminAuditQuery): { from: string; to: string } {
  if (query.cursor && (!query.from || !query.to))
    throw new BadRequestException('Cursor needs fixed dates')
  const now = Date.now()
  const to = query.to ? new Date(query.to).getTime() : now
  const from = query.from ? new Date(query.from).getTime() : to - DEFAULT_WINDOW_MS
  if (
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    from >= to ||
    to > now ||
    to - from > MAX_WINDOW_MS
  )
    throw new BadRequestException('Invalid audit time range')
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() }
}

function filters(
  query: AdminAuditQuery
): Pick<
  AdminAuditQuery,
  'actorId' | 'actorType' | 'action' | 'targetId' | 'targetType' | 'organizationId'
> {
  const { actorId, actorType, action, targetId, targetType, organizationId } = query
  return { actorId, actorType, action, targetId, targetType, organizationId }
}

@Injectable()
export class AdminAuditService {
  private readonly cursor: AuditCursorCodec

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    env: EnvService
  ) {
    this.cursor = new AuditCursorCodec(env.get('JWT_SECRET'))
  }

  async list(query: AdminAuditQuery, actor: RequestPrincipal): Promise<AdminAuditResponse> {
    const window = effectiveWindow(query)
    const scope = { ...window, filters: filters(query), operatorId: actor.sub }
    const cursorKey = query.cursor ? this.cursor.open(query.cursor, scope) : null
    const data = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL statement_timeout = '2s'`
        const anchor = cursorKey
          ? await tx.auditLog.findUnique({
              where: { cursorKey },
              select: { id: true, createdAt: true },
            })
          : null
        if (
          cursorKey &&
          (!anchor ||
            anchor.createdAt < new Date(window.from) ||
            anchor.createdAt >= new Date(window.to))
        )
          throw new BadRequestException('Invalid cursor')
        const where: Prisma.AuditLogWhereInput = {
          createdAt: { gte: new Date(window.from), lt: new Date(window.to) },
          ...filters(query),
          ...(anchor
            ? {
                AND: [
                  {
                    OR: [
                      { createdAt: { lt: anchor.createdAt } },
                      { createdAt: anchor.createdAt, id: { lt: anchor.id } },
                    ],
                  },
                ],
              }
            : {}),
        }
        const rows = await tx.auditLog.findMany({
          where,
          select: SELECT,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: query.limit + 1,
        })
        const page = rows.slice(0, query.limit)
        const userIds = new Set<string>()
        const organizationIds = new Set<string>()
        for (const row of page) {
          if (row.actorType === 'USER' && safeAuditId(row.actorId)) userIds.add(row.actorId!)
          if (row.targetType === 'USER' && safeAuditId(row.targetId)) userIds.add(row.targetId!)
          if (row.targetType === 'ORGANIZATION' && safeAuditId(row.targetId))
            organizationIds.add(row.targetId!)
          if (safeAuditId(row.organizationId)) organizationIds.add(row.organizationId!)
        }
        const users = userIds.size
          ? await tx.user.findMany({
              where: { id: { in: [...userIds] } },
              select: { id: true, name: true, email: true },
            })
          : []
        const organizations = organizationIds.size
          ? await tx.organization.findMany({
              where: { id: { in: [...organizationIds] } },
              select: { id: true, name: true, slug: true },
            })
          : []
        return {
          rows: page,
          hasMore: rows.length > query.limit,
          users: new Map(users.map((user) => [user.id, user])),
          organizations: new Map(
            organizations.map((organization) => [organization.id, organization])
          ),
        }
      },
      { timeout: 5_000 }
    )

    const items = data.rows.map((row) => projectAuditRow(row, data.users, data.organizations))
    const last = data.rows.at(-1)
    const nextCursor = data.hasMore && last ? this.cursor.seal(last.cursorKey, scope) : null
    await this.audit.record(
      {
        action: 'admin.audit_logs.viewed',
        actorType: AuditActorType.USER,
        actorId: actor.sub,
        category: AuditCategory.SECURITY,
        metadata: {
          actor: !!(query.actorId || query.actorType),
          action: !!query.action,
          target: !!(query.targetId || query.targetType),
          organization: !!query.organizationId,
          time: !!(query.from || query.to),
          resultCount: items.length,
        },
      },
      { failOpen: false }
    )
    return { items, hasMore: data.hasMore, nextCursor, ...window }
  }
}
