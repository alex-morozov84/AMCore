import { Injectable } from '@nestjs/common'

import { type SystemRole } from '@amcore/shared'

import { PrismaService } from '../../prisma'

/**
 * Privileged-role freshness reader (OB-06a / ADR-037).
 *
 * Reads the user's CURRENT `systemRole` straight from Postgres — deliberately
 * NOT via `UserCacheService`. ADR-037 §A-int requires a strict next-request
 * intersection (`JWT claim ∩ current DB role`) for privileged routes with no
 * stale-cache window: a failed cache invalidation must never keep a demoted
 * SUPER_ADMIN privileged.
 *
 * Used only by `SystemRolesGuard`, which runs only on `@SystemRoles`-decorated
 * routes (low-traffic `/admin/**`), so this extra indexed PK read never touches
 * the authenticated hot path.
 *
 * Returns `null` when the user row is absent (hard delete, ADR-030) so the
 * guard fails closed. Does NOT catch Prisma errors — an infra failure
 * propagates to the global exception filters (503 via ADR-032), which is
 * fail-closed (never a grant) and observable, instead of being masked as a 403.
 */
@Injectable()
export class PrivilegedRoleService {
  constructor(private readonly prisma: PrismaService) {}

  async getCurrentSystemRole(userId: string): Promise<SystemRole | null> {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { systemRole: true },
    })
    return row?.systemRole ?? null
  }
}
