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

import { BusinessRuleViolationException, NotFoundException } from '../../common/exceptions/index.js'
import { AuditActorType, AuditTargetType } from '../../generated/prisma/client.js'
import { GeoIpService } from '../../infrastructure/geoip/geoip.service.js'
import { PrismaService } from '../../prisma/index.js'
import { AuditLogService } from '../audit/index.js'

import { AdminCommandAdmission } from './admin-command-admission.js'
import { querySessionPage, type SessionListRow } from './admin-session-query.js'

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
    private readonly logger: PinoLogger,
    private readonly commandAdmission: AdminCommandAdmission
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

    return this.prisma.$transaction(
      async (tx) => {
        await this.commandAdmission.assert(tx, actor, [targetUserId])

        const existing = await tx.session.findFirst({
          where: { userId: targetUserId, familyId },
          select: { id: true },
        })
        if (!existing) {
          const family = await tx.authSessionFamily.findUnique({ where: { id: familyId } })
          if (!family || family.userId !== targetUserId)
            throw new NotFoundException('Session', familyId)
        }

        await tx.authSessionFamily.updateMany({
          where: { id: familyId, userId: targetUserId, revokedAt: null },
          data: { revokedAt: new Date(), publicationState: 'retired' },
        })

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
        await this.commandAdmission.assert(tx, actor, [targetUserId])

        return { affected: result.count > 0 ? 1 : 0 }
      },
      { maxWait: 2000, timeout: 4000 }
    )
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

    return this.prisma.$transaction(
      async (tx) => {
        await this.commandAdmission.assert(tx, actor, [targetUserId])

        const now = new Date()
        // Include issued/pending families even when their original SID has already been cleaned up.
        // Independent pre-login capabilities are not account-lockout or epoch changes.
        await tx.authSessionFamily.updateMany({
          where: { userId: targetUserId, revokedAt: null },
          data: { revokedAt: now, publicationState: 'retired' },
        })
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
        await this.commandAdmission.assert(tx, actor, [targetUserId])

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
      },
      { maxWait: 2000, timeout: 4000 }
    )
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
