import { HttpStatus, Injectable } from '@nestjs/common'

import { AuthErrorCode, type RequestPrincipal, SystemRole } from '@amcore/shared'

import { AppException, ForbiddenException, UnauthorizedException } from '@/common/exceptions'
import { EnvService } from '@/env/env.service'
import type { ControlTransaction } from '@/infrastructure/background-work/control-transaction'

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
      throw new UnauthorizedException('Current personal session required')
    await ctx.tx.$queryRaw`SELECT id FROM core.users WHERE id = ${principal.sub} FOR SHARE`
    const user = await ctx.tx.user.findUnique({
      where: { id: principal.sub },
      select: { systemRole: true },
    })
    if (user?.systemRole !== SystemRole.SuperAdmin)
      throw new ForbiddenException('Current SUPER_ADMIN role required')
    await ctx.tx.$queryRaw`SELECT id FROM core.sessions WHERE id = ${principal.sid} FOR SHARE`
    const session = await ctx.tx.session.findUnique({
      where: { id: principal.sid },
      select: { userId: true, revokedAt: true, expiresAt: true, lastAuthAt: true },
    })
    if (
      !session ||
      session.userId !== principal.sub ||
      session.revokedAt ||
      session.expiresAt.getTime() <= ctx.now.getTime()
    )
      throw new UnauthorizedException('Current personal session required')
    if (
      fresh &&
      (!session.lastAuthAt ||
        ctx.now.getTime() - session.lastAuthAt.getTime() >
          this.env.get('STEP_UP_MAX_AGE_SECONDS') * 1000)
    )
      throw new AppException(
        'Step-up authentication required',
        HttpStatus.FORBIDDEN,
        AuthErrorCode.STEP_UP_REQUIRED
      )
  }
}
