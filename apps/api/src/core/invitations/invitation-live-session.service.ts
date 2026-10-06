import { Injectable } from '@nestjs/common'

import type { RequestPrincipal } from '@amcore/shared'

import { UnauthorizedException } from '../../common/exceptions'
import { PrismaService } from '../../prisma'

import { invitationClock } from './invitation-locks'

import type { Prisma } from '@/generated/prisma/client'

/** Invitation endpoints opt into live session validation; ordinary JWT auth stays stateless. */
@Injectable()
export class InvitationLiveSessionService {
  constructor(private readonly prisma: PrismaService) {}

  async assert(
    principal: RequestPrincipal,
    tx: Prisma.TransactionClient = this.prisma
  ): Promise<void> {
    if (principal.type !== 'jwt' || !principal.sid) throw new UnauthorizedException()
    const [session] = await tx.$queryRaw<{ expiresAt: Date; revokedAt: Date | null }[]>`
      SELECT "expiresAt", "revokedAt" FROM core.sessions
      WHERE id = ${principal.sid} AND "userId" = ${principal.sub} FOR SHARE`
    const now = await invitationClock(tx)
    if (!session || session.revokedAt || session.expiresAt <= now) throw new UnauthorizedException()
    const handoff = await tx.invitationAuthHandoff.findUnique({
      where: { sessionId: principal.sid },
    })
    if (handoff && handoff.status !== 'confirmed')
      throw new UnauthorizedException('Authentication handoff incomplete')
  }
}
