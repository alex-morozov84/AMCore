import { Injectable } from '@nestjs/common'

import { SystemRole } from '@amcore/shared'

import { hashRefreshToken } from '@/core/auth/utils/refresh-token-hash'
import { PrismaService } from '@/prisma'

/**
 * Outcome of a Bull Board access check. Three states so the middleware can
 * map them to the correct HTTP status: a missing/invalid session is
 * `unauthenticated` (401); a valid session whose user is not a platform
 * super-admin is `forbidden` (403).
 */
export type BullBoardAccess = 'authorized' | 'unauthenticated' | 'forbidden'

/**
 * Read-only access verifier for the Bull Board dashboard (EQS-01).
 *
 * Bull Board is a browser UI, so the only credential the browser carries is
 * the `refresh_token` httpOnly cookie. This service resolves that cookie to a
 * platform `SUPER_ADMIN` decision **without any side effects**: it must NOT
 * reuse `SessionService.validateRefreshToken`, which deletes expired sessions
 * and triggers reuse-detection family revocation on rotated tokens — a
 * dashboard asset load must never mutate session state. It depends only on the
 * global `PrismaService` and the shared hash helper, never on `AuthModule`
 * (which would close a `QueueModule → AuthModule → EmailModule → QueueModule`
 * import cycle).
 *
 * `systemRole` is read live from the user row, so a demoted admin loses
 * dashboard access on the next request (ADR-035 freshness spirit).
 */
@Injectable()
export class BullBoardAuthService {
  constructor(private readonly prisma: PrismaService) {}

  async verifyAccess(rawRefreshToken: string): Promise<BullBoardAccess> {
    const session = await this.prisma.session.findUnique({
      where: { refreshToken: hashRefreshToken(rawRefreshToken) },
      select: {
        expiresAt: true,
        revokedAt: true,
        user: { select: { systemRole: true } },
      },
    })

    if (!session || session.revokedAt !== null || session.expiresAt < new Date()) {
      return 'unauthenticated'
    }

    return session.user.systemRole === SystemRole.SuperAdmin ? 'authorized' : 'forbidden'
  }
}
