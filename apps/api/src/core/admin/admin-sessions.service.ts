import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import {
  type AdminSession,
  type AdminSessionsListResponse,
  type AdminSessionsQuery,
  type AdminSessionsRevokeResult,
  type RequestPrincipal,
  type SupportedLocale,
} from '@amcore/shared'

import { BusinessRuleViolationException, NotFoundException } from '../../common/exceptions'
import { GeoIpService } from '../../infrastructure/geoip/geoip.service'
import { acquireXactLock, PrismaService } from '../../prisma'
import { AuditLogService } from '../audit'
import { sessionCoordinationLockKey } from '../auth/session-lock-key'

import { querySessionPage, type SessionListRow } from './admin-session-query'

import { AuditActorType, AuditTargetType } from '@/generated/prisma/client'

/**
 * SUPER_ADMIN session viewer/revocation for another user's account.
 *
 * Deliberately implemented against `PrismaService` directly rather than
 * injecting `SessionService` — importing the cycle-heavy `AuthModule` into
 * `AdminModule` is the same tradeoff `admin.service.ts`'s
 * `revokeTargetSessions` already made. Both this service and
 * `SessionService.rotateRefreshToken` instead share the exact same
 * `sessionCoordinationLockKey(userId)` advisory-lock namespace (a plain
 * function, not a module import) so a refresh rotation and an admin revoke
 * on the same user's sessions always serialize against each other.
 */
@Injectable()
export class AdminSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly geoIp: GeoIpService,
    private readonly auditLog: AuditLogService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(AdminSessionsService.name)
  }

  /** Active families; page and total are projected from one SQL snapshot. */
  async list(
    targetUserId: string,
    query: AdminSessionsQuery,
    locale: SupportedLocale,
    actor: RequestPrincipal
  ): Promise<AdminSessionsListResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true },
    })
    if (!user) throw new NotFoundException('User', targetUserId)

    const { rows, total } = await querySessionPage(this.prisma, targetUserId, query)

    await this.auditLog.record({
      action: 'admin.user.sessions_viewed',
      actorId: actor.sub,
      actorType: AuditActorType.USER,
      metadata: { page: query.page, limit: query.limit, resultCount: rows.length },
      targetId: targetUserId,
      targetType: AuditTargetType.USER,
    })

    return {
      data: rows.map((row) => this.toAdminSession(row, locale)),
      total,
      page: query.page,
      limit: query.limit,
    }
  }

  /**
   * Revoke one logical session family. `404` if the family is absent or
   * belongs to a different user; `{ affected: 0 }` (still `204` at the
   * controller) if it already existed but was already inactive/expired —
   * idempotent, not an error. Soft-revoke only, never `deleteMany`.
   */
  async revokeOne(
    targetUserId: string,
    familyId: string,
    actor: RequestPrincipal
  ): Promise<AdminSessionsRevokeResult> {
    this.rejectSelfTarget(targetUserId, actor)

    return this.prisma.$transaction(async (tx) => {
      await acquireXactLock(tx, sessionCoordinationLockKey(targetUserId))

      const existing = await tx.session.findFirst({
        where: { userId: targetUserId, familyId },
        select: { id: true },
      })
      if (!existing) throw new NotFoundException('Session', familyId)

      const result = await tx.session.updateMany({
        where: { userId: targetUserId, familyId, revokedAt: null, expiresAt: { gt: new Date() } },
        data: { revokedAt: new Date(), revocationReason: 'admin_revoked' },
      })

      await this.auditLog.record(
        {
          action: 'admin.user.session_revoked',
          actorId: actor.sub,
          actorType: AuditActorType.USER,
          metadata: { sessionId: familyId, count: result.count > 0 ? 1 : 0 },
          targetId: targetUserId,
          targetType: AuditTargetType.USER,
        },
        { tx }
      )

      return { affected: result.count > 0 ? 1 : 0 }
    })
  }

  /**
   * Revoke every active session family for the user. Always `204` and
   * always audited — including when zero sessions were active — with the
   * actual affected count, never a claimed change that did not happen.
   */
  async revokeAll(
    targetUserId: string,
    actor: RequestPrincipal
  ): Promise<AdminSessionsRevokeResult> {
    this.rejectSelfTarget(targetUserId, actor)

    return this.prisma.$transaction(async (tx) => {
      await acquireXactLock(tx, sessionCoordinationLockKey(targetUserId))

      const now = new Date()
      const families = await tx.session.findMany({
        where: { userId: targetUserId, revokedAt: null, expiresAt: { gt: now } },
        select: { familyId: true },
        distinct: ['familyId'],
      })
      await tx.session.updateMany({
        where: {
          userId: targetUserId,
          familyId: { in: families.map((row) => row.familyId) },
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { revokedAt: now, revocationReason: 'admin_revoked' },
      })
      const count = families.length

      await this.auditLog.record(
        {
          action: 'admin.user.sessions_revoked',
          actorId: actor.sub,
          actorType: AuditActorType.USER,
          metadata: { count: count, reason: 'admin_bulk_revoke' },
          targetId: targetUserId,
          targetType: AuditTargetType.USER,
        },
        { tx }
      )

      this.logger.info(
        {
          event: 'auth.admin.sessions_revoked',
          actorUserId: actor.sub,
          targetUserId,
          count: count,
        },
        'Admin revoked all sessions for target user'
      )

      return { affected: count }
    })
  }

  private rejectSelfTarget(targetUserId: string, actor: RequestPrincipal): void {
    if (targetUserId === actor.sub) {
      throw new BusinessRuleViolationException('Use Settings to manage your own sessions')
    }
  }

  private toAdminSession(row: SessionListRow, locale: SupportedLocale): AdminSession {
    return {
      sessionId: row.familyId,
      userAgent: row.userAgent,
      ipAddress: row.ipAddress,
      location: this.geoIp.resolve(row.ipAddress, locale),
      lastAuthAt: row.lastAuthAt ? new Date(row.lastAuthAt).toISOString() : null,
      createdAt: new Date(row.createdAt).toISOString(),
      expiresAt: new Date(row.expiresAt).toISOString(),
    }
  }
}
