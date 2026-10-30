import { Injectable } from '@nestjs/common'

import { type RequestPrincipal, SystemRole } from '@amcore/shared'

import { ForbiddenException } from '../../common/exceptions/index.js'
import { EnvService } from '../../env/env.service.js'
import type { Prisma } from '../../generated/prisma/client.js'
import { lockMfaAccounts } from '../auth/mfa/mfa-transaction.js'
import { assertSessionFresh } from '../auth/session-freshness.js'

/** Final command admission. Caller takes any global role mutex before these sorted account locks. */
@Injectable()
export class AdminCommandAdmission {
  constructor(private readonly env: EnvService) {}

  async assert(
    tx: Prisma.TransactionClient,
    actor: RequestPrincipal,
    targets: string[]
  ): Promise<void> {
    if (actor.type !== 'jwt' || actor.systemRole !== SystemRole.SuperAdmin)
      throw new ForbiddenException('Personal SUPER_ADMIN credential required')
    await lockMfaAccounts(tx, [actor.sub, ...targets])
    await tx.$queryRaw`SELECT id FROM core.users WHERE id = ${actor.sub} FOR SHARE`
    const user = await tx.user.findUnique({
      where: { id: actor.sub },
      select: { systemRole: true },
    })
    if (user?.systemRole !== SystemRole.SuperAdmin)
      throw new ForbiddenException('Current SUPER_ADMIN role required')
    // Browser-generation writers acquire the same owner lock; this check never locks context late.
    await assertSessionFresh(tx, this.env.get('STEP_UP_MAX_AGE_SECONDS'), actor)
  }
}
