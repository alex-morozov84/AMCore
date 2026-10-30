import { Injectable } from '@nestjs/common'

import { type RequestPrincipal, SystemRole } from '@amcore/shared'

import { ForbiddenException, UnauthorizedException } from '../../common/exceptions/index.js'
import { EnvService } from '../../env/env.service.js'
import type { ControlTransaction } from '../../infrastructure/background-work/control-transaction.js'
import { acquireXactLock } from '../../prisma/index.js'
import { requireMfaAdmission } from '../auth/mfa/mfa-admission-result.js'
import { MfaAuthorityReader } from '../auth/mfa/mfa-authority-reader.service.js'
import { principalBrowserBinding } from '../auth/mfa/mfa-principal-binding.js'
import { refreshSessionChanged } from '../auth/mfa/mfa-refresh-authority.js'
import { mfaDatabaseClock } from '../auth/mfa/mfa-transaction.js'
import { assertSessionFresh } from '../auth/session-freshness.js'
import { sessionCoordinationLockKey } from '../auth/session-lock-key.js'

/** All reads/actions use current primary session; dispatch repeats this check inside its tx. */
@Injectable()
export class BackgroundControlAuthority {
  constructor(private readonly env: EnvService) {}

  async assert(
    ctx: ControlTransaction,
    principal: RequestPrincipal,
    fresh: boolean
  ): Promise<void> {
    if (
      principal.type !== 'jwt' ||
      principal.organizationId !== undefined ||
      principal.systemRole !== SystemRole.SuperAdmin
    )
      throw new ForbiddenException('Personal SUPER_ADMIN credential required')
    if (!principal.sid || principal.sub.length > 64)
      throw principal.fid !== undefined || principal.browserBound !== undefined
        ? refreshSessionChanged()
        : new UnauthorizedException('Current personal session required')
    // Preserve the control transaction's stricter timeout instead of resetting it to the MFA default.
    await acquireXactLock(ctx.tx, sessionCoordinationLockKey(principal.sub))
    await ctx.tx.$queryRaw`SELECT id FROM core.users WHERE id = ${principal.sub} FOR SHARE`
    const user = await ctx.tx.user.findUnique({
      where: { id: principal.sub },
      select: { systemRole: true },
    })
    if (user?.systemRole !== SystemRole.SuperAdmin)
      throw new ForbiddenException('Current SUPER_ADMIN role required')
    if (principal.fid !== undefined || principal.browserBound !== undefined) {
      await this.assertFamily(ctx, principal, fresh)
      return
    }
    await ctx.tx.$queryRaw`SELECT id FROM core.sessions WHERE id = ${principal.sid} FOR SHARE`
    const session = await ctx.tx.session.findUnique({
      where: { id: principal.sid },
      select: { userId: true, revokedAt: true, expiresAt: true, familyId: true },
    })
    const now = await mfaDatabaseClock(ctx.tx)
    if (
      !session ||
      session.userId !== principal.sub ||
      session.revokedAt ||
      session.expiresAt <= now
    )
      throw principal.fid !== undefined || principal.browserBound !== undefined
        ? refreshSessionChanged()
        : new UnauthorizedException('Current personal session required')
    await this.assertFamily(ctx, principal, fresh)
  }

  private async assertFamily(
    ctx: ControlTransaction,
    principal: RequestPrincipal,
    fresh: boolean
  ): Promise<void> {
    if (fresh) {
      await assertSessionFresh(ctx.tx, this.env.get('STEP_UP_MAX_AGE_SECONDS'), principal)
    } else {
      requireMfaAdmission(
        await new MfaAuthorityReader(ctx.tx).readForRuntime(
          { ...principal, email: principal.email ?? '' },
          principalBrowserBinding(principal)
        )
      )
    }
  }
}
