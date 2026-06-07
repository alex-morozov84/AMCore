import { Injectable } from '@nestjs/common'
import { AuditActorType, AuditTargetType, type Prisma } from '@prisma/client'
import { PinoLogger } from 'nestjs-pino'

import {
  type AdminOrganizationListResponse,
  type AdminOrganizationResponse,
  type AdminUserListResponse,
  type AdminUserResponse,
  type RequestPrincipal,
  SystemRole,
} from '@amcore/shared'

import { BusinessRuleViolationException, NotFoundException } from '../../common/exceptions'
import type { CleanupResult } from '../../infrastructure/schedule/cleanup.service'
import { CleanupService } from '../../infrastructure/schedule/cleanup.service'
import { PrismaService } from '../../prisma'
import { AuditLogService } from '../audit'

type PrismaTx = Prisma.TransactionClient

/**
 * Prisma `select` allowlist for admin user responses (OA-07).
 *
 * Mirrors `adminUserResponseSchema` in `@amcore/shared` field-for-field.
 * Sensitive columns (`passwordHash`, `emailCanonical`) are absent so
 * the DB does not even read them. Adding a new sensitive column to
 * `User` cannot auto-leak — it must be explicitly added here.
 */
const ADMIN_USER_SELECT = {
  id: true,
  email: true,
  emailVerified: true,
  name: true,
  avatarUrl: true,
  phone: true,
  locale: true,
  timezone: true,
  systemRole: true,
  createdAt: true,
  updatedAt: true,
  lastLoginAt: true,
} as const satisfies Prisma.UserSelect

type AdminUserRow = Prisma.UserGetPayload<{ select: typeof ADMIN_USER_SELECT }>

/**
 * Prisma `select` allowlist for admin organization responses (OA-08).
 *
 * Mirrors `adminOrganizationResponseSchema`. `aclVersion` (internal
 * RBAC freshness counter, ADR-035) is deliberately absent so the wire
 * shape does not depend on internal cache invalidation state.
 */
const ADMIN_ORGANIZATION_SELECT = {
  id: true,
  name: true,
  slug: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.OrganizationSelect

type AdminOrganizationRow = Prisma.OrganizationGetPayload<{
  select: typeof ADMIN_ORGANIZATION_SELECT
}>

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cleanupService: CleanupService,
    private readonly auditLog: AuditLogService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(AdminService.name)
  }

  async findAllUsers(page: number, limit: number): Promise<AdminUserListResponse> {
    const skip = (page - 1) * limit
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: ADMIN_USER_SELECT,
      }),
      this.prisma.user.count(),
    ])
    return {
      data: rows.map((row) => this.toAdminUserResponse(row)),
      total,
      page,
      limit,
    }
  }

  /**
   * Change a user's platform-level system role (OA-09).
   *
   * Self-demotion is denied based on the request principal, not on a
   * re-read of current DB state. Reaching this method already means
   * the actor is SUPER_ADMIN at the time of the request (enforced by
   * `SystemRolesGuard`); a self-targeted demotion is a foot-gun
   * regardless of how stale the actor's token is. The alternative
   * (read DB → maybe allow if actor was already demoted meanwhile)
   * would tie the user-facing rule to a race we don't want.
   *
   * Last-SUPER_ADMIN guard runs inside a transaction-scoped advisory
   * lock (`system-role:SUPER_ADMIN`) so two concurrent demotions
   * cannot both see `otherSACount === 1` and both succeed (Postgres
   * READ COMMITTED would allow that without the lock).
   *
   * No-op requests (`before === after`) short-circuit: no DB write,
   * no audit event — emitting "role changed" with identical before/
   * after fields would be misleading.
   *
   * Audit log is emitted strictly **after** the transaction commits,
   * so a rolled-back attempt never produces a misleading
   * `system_role_changed` event.
   */
  async updateUserSystemRole(
    id: string,
    systemRole: SystemRole,
    actor: RequestPrincipal
  ): Promise<AdminUserResponse> {
    if (id === actor.sub && systemRole !== SystemRole.SuperAdmin) {
      throw new BusinessRuleViolationException('You cannot change your own system role')
    }

    const { before, after, row } = await this.prisma.$transaction(async (tx) => {
      await this.acquireXactLock(tx, 'system-role:SUPER_ADMIN')

      const target = await tx.user.findUnique({ where: { id }, select: ADMIN_USER_SELECT })
      if (!target) throw new NotFoundException('User', id)

      // No-op: nothing to write, nothing to audit.
      if (target.systemRole === systemRole) {
        return { before: target.systemRole, after: target.systemRole, row: target }
      }

      // Last-SUPER_ADMIN guard for the demotion case only.
      if (target.systemRole === SystemRole.SuperAdmin && systemRole !== SystemRole.SuperAdmin) {
        const otherSACount = await tx.user.count({
          where: { systemRole: SystemRole.SuperAdmin, id: { not: id } },
        })
        if (otherSACount === 0) {
          throw new BusinessRuleViolationException('Cannot demote the last SUPER_ADMIN')
        }
      }

      const updated = await tx.user.update({
        where: { id },
        data: { systemRole },
        select: ADMIN_USER_SELECT,
      })

      await this.auditLog.record(
        {
          action: 'admin.user.system_role_changed',
          actorId: actor.sub,
          actorType: AuditActorType.USER,
          metadata: {
            afterSystemRole: updated.systemRole,
            beforeSystemRole: target.systemRole,
            pinoEvent: 'auth.admin.system_role_changed',
          },
          targetId: id,
          targetType: AuditTargetType.USER,
        },
        { tx }
      )

      return { before: target.systemRole, after: updated.systemRole, row: updated }
    })

    if (before !== after) {
      this.logger.info(
        {
          event: 'auth.admin.system_role_changed',
          actorUserId: actor.sub,
          targetUserId: id,
          beforeSystemRole: before,
          afterSystemRole: after,
        },
        'Admin changed user system role'
      )

      await this.revokeTargetSessions(id, actor.sub)
    }

    return this.toAdminUserResponse(row)
  }

  /**
   * Manually trigger the expired-records cleanup (OA-09). Audit log
   * is emitted on success only; failures propagate through the
   * exception filter chain and are logged there.
   */
  async runCleanup(actor: RequestPrincipal): Promise<CleanupResult> {
    const result = await this.cleanupService.runCleanup()

    await this.auditLog.record({
      action: 'admin.cleanup.executed',
      actorId: actor.sub,
      actorType: AuditActorType.USER,
      metadata: {
        counts: result,
        pinoEvent: 'auth.admin.cleanup_executed',
      },
      targetType: AuditTargetType.CLEANUP,
    })

    this.logger.info(
      {
        event: 'auth.admin.cleanup_executed',
        actorUserId: actor.sub,
        counts: result,
      },
      'Admin triggered cleanup'
    )

    return result
  }

  async findAllOrganizations(page: number, limit: number): Promise<AdminOrganizationListResponse> {
    const skip = (page - 1) * limit
    const [rows, total] = await Promise.all([
      this.prisma.organization.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: ADMIN_ORGANIZATION_SELECT,
      }),
      this.prisma.organization.count(),
    ])
    return {
      data: rows.map((row) => this.toAdminOrganizationResponse(row)),
      total,
      page,
      limit,
    }
  }

  /**
   * Revoke the target user's sessions after a committed system-role change
   * (OB-06a / ADR-037, amendment 2026-05-30 — fires on ANY `before !== after`
   * change, demotion and promotion alike).
   *
   * Why both directions: a demotion loses privileged access on the next
   * request via the `SystemRolesGuard` claim ∩ current-DB-role check; this
   * revocation additionally signs the user out so a compromised admin's
   * sessions are killed, and — critically — a promotion cannot silently
   * elevate an existing lower-privilege refresh session (refresh mints from
   * the current DB role), so the promoted user must re-authenticate.
   *
   * Best-effort and post-commit: the role change is already committed, so a
   * Redis/DB hiccup here must NOT roll it back or surface as 500 (mirrors the
   * AK-12 best-effort pattern). A direct `deleteMany` is used rather than
   * injecting `SessionService` to avoid importing the cycle-heavy `AuthModule`
   * into `AdminModule`; the semantics are identical. The payloads carry only
   * CUIDs and a count — the operation never reads a refresh-token value or
   * hash, so there is no token material to leak.
   */
  private async revokeTargetSessions(targetUserId: string, actorUserId: string): Promise<void> {
    try {
      const { count } = await this.prisma.session.deleteMany({ where: { userId: targetUserId } })
      await this.auditLog.record({
        action: 'admin.user.sessions_revoked',
        actorId: actorUserId,
        actorType: AuditActorType.USER,
        metadata: {
          count,
          pinoEvent: 'auth.admin.sessions_revoked',
          reason: 'system_role_changed',
        },
        targetId: targetUserId,
        targetType: AuditTargetType.USER,
      })
      this.logger.info(
        { event: 'auth.admin.sessions_revoked', actorUserId, targetUserId, count },
        'Revoked target sessions after system-role change'
      )
    } catch (err) {
      this.logger.warn(
        { event: 'auth.admin.session_revoke_failed', actorUserId, targetUserId, err },
        'Failed to revoke target sessions after system-role change'
      )
    }
  }

  /**
   * Transaction-scoped advisory lock. Hashed via `hashtextextended` so
   * any string namespace fits into Postgres `bigint`. `${key}` is
   * always parameterized — never string-interpolated — so callers
   * cannot accidentally inject SQL through a lock key.
   */
  private async acquireXactLock(tx: PrismaTx, key: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0)::bigint)`
  }

  /**
   * Sole exit path from admin user reads (OA-07). Converts Prisma
   * `Date` columns into ISO strings so `@ZodSerializerDto` with
   * `z.iso.datetime()` validates correctly (interceptor runs before
   * Nest's JSON serialization). Mirrors the existing pattern in
   * `auth.service.ts:333-334` and `oauth.service.ts:241-242`.
   */
  private toAdminUserResponse(row: AdminUserRow): AdminUserResponse {
    return {
      id: row.id,
      email: row.email,
      emailVerified: row.emailVerified,
      name: row.name,
      avatarUrl: row.avatarUrl,
      phone: row.phone,
      locale: row.locale,
      timezone: row.timezone,
      systemRole: row.systemRole,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    }
  }

  /** Sole exit path from admin organization reads (OA-08). */
  private toAdminOrganizationResponse(row: AdminOrganizationRow): AdminOrganizationResponse {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }
  }
}
