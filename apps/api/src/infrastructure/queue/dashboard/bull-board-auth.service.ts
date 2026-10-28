import { Injectable } from '@nestjs/common'

import { SystemRole } from '@amcore/shared'

import { AppException } from '../../../common/exceptions/index.js'
import { MfaAuthorityReader } from '../../../core/auth/mfa/mfa-authority-reader.service.js'
import { hashRefreshToken } from '../../../core/auth/utils/refresh-token-hash.js'
import { BrowserSessionContextService } from '../../../core/frontend-context/browser-session-context.service.js'
import { PrismaService } from '../../../prisma/index.js'

import { type BoardAuthRequest, boardBrowserBinding } from './bull-board-auth-context.js'

/**
 * Outcome of a read-only access check: invalid credential401, current role403,
 * changed family/browser authority409, or unavailable verification503.
 */
export type BullBoardAccess =
  'authorized' | 'unauthenticated' | 'forbidden' | 'session_changed' | 'unavailable'

/**
 * Read-only access verifier for the Bull Board dashboard (EQS-01).
 *
 * Bull Board is a browser UI, so the only credential the browser carries is
 * the `refresh_token` httpOnly cookie. This service resolves that cookie to a
 * platform `SUPER_ADMIN` decision **without any side effects**: it must NOT
 * reuse `SessionService.validateRefreshToken`, which deletes expired sessions
 * and triggers reuse-detection family revocation on rotated tokens — a
 * dashboard asset load must never mutate session state. It uses primary-only family admission and private browser normalization,
 * never `AuthModule`
 * (which would close a `QueueModule → AuthModule → EmailModule → QueueModule`
 * import cycle).
 *
 * `systemRole` is read live from the user row, so a demoted admin loses
 * dashboard access on the next request (ADR-035 freshness spirit).
 */
@Injectable()
export class BullBoardAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authority: MfaAuthorityReader,
    private readonly contexts: BrowserSessionContextService
  ) {}

  async verifyAccess(
    rawRefreshToken: string,
    request?: BoardAuthRequest
  ): Promise<BullBoardAccess> {
    let binding
    try {
      binding = boardBrowserBinding(this.contexts, request)
    } catch (error) {
      if (error instanceof AppException)
        return error.errorCode === 'SESSION_CHANGED' ? 'session_changed' : 'forbidden'
      throw error
    }
    const session = await this.prisma.session.findUnique({
      where: { refreshToken: hashRefreshToken(rawRefreshToken) },
      select: {
        id: true,
        userId: true,
        familyId: true,
        expiresAt: true,
        revokedAt: true,
        user: { select: { systemRole: true } },
      },
    })

    if (!session || session.revokedAt !== null || session.expiresAt < new Date()) {
      return 'unauthenticated'
    }

    if (session.user.systemRole !== SystemRole.SuperAdmin) return 'forbidden'
    const family = await this.prisma.authSessionFamily.findUnique({
      where: { id: session.familyId },
    })
    const result = await this.authority.readForRuntime(
      {
        sub: session.userId,
        email: '',
        systemRole: session.user.systemRole,
        sid: session.id,
        ...(family && {
          fid: family.id,
          securityVersion: family.securityVersion,
          ...(family.browserContextId && { browserBound: true as const }),
        }),
      },
      binding
    )
    if (result.kind === 'denied')
      return result.reason === 'enforcement_unavailable' ? 'unavailable' : 'session_changed'
    return result.operator ? 'authorized' : 'forbidden'
  }
}
