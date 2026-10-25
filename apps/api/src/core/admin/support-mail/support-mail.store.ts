import { Injectable } from '@nestjs/common'

import { type RequestPrincipal, ResourceErrorCode } from '@amcore/shared'

import { AppException, ForbiddenException } from '../../../common/exceptions/index.js'
import type { Prisma, SupportMailAttempt } from '../../../generated/prisma/client.js'
import { acquireSharedXactLock, acquireXactLock, PrismaService } from '../../../prisma/index.js'
import { authMailClock, lockAuthMailTokens } from '../../auth/auth-mail-token-lock.js'
import { sessionCoordinationLockKey } from '../../auth/session-lock-key.js'

import { MAIL_USER_SELECT, type MailUser } from './support-mail.common.js'

@Injectable()
export class SupportMailStore {
  constructor(readonly db: PrismaService) {}
  transaction<T>(action: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '1000ms'`
        return action(tx)
      },
      { maxWait: 2000, timeout: 4000, isolationLevel: 'ReadCommitted' }
    )
  }

  async admit(
    tx: Prisma.TransactionClient,
    actor: RequestPrincipal,
    targetId: string,
    write = false
  ): Promise<MailUser> {
    if (
      actor.type !== 'jwt' ||
      actor.organizationId !== undefined ||
      !actor.sid ||
      actor.systemRole !== 'SUPER_ADMIN'
    )
      throw this.forbidden()
    await acquireSharedXactLock(tx, 'system-role:SUPER_ADMIN')
    if (write) {
      await acquireXactLock(tx, sessionCoordinationLockKey(actor.sub))
      await lockAuthMailTokens(tx, targetId)
    }
    for (const id of [...new Set([actor.sub, targetId])].sort())
      await tx.$queryRaw`SELECT id FROM core.users WHERE id=${id} FOR SHARE`
    await tx.$queryRaw`SELECT id FROM core.sessions WHERE id=${actor.sid} FOR SHARE`
    const operator = await tx.user.findUnique({
      where: { id: actor.sub },
      select: { systemRole: true },
    })
    const session = await tx.session.findUnique({ where: { id: actor.sid } })
    const now = await authMailClock(tx)
    if (
      operator?.systemRole !== 'SUPER_ADMIN' ||
      !session ||
      session.userId !== actor.sub ||
      session.revokedAt ||
      session.expiresAt <= now
    )
      throw this.forbidden()
    const user = await tx.user.findUnique({ where: { id: targetId }, select: MAIL_USER_SELECT })
    if (!user) throw this.notFound()
    return user
  }

  async attempt(
    tx: Prisma.TransactionClient,
    actor: RequestPrincipal,
    targetId: string,
    id: string,
    write = false
  ): Promise<SupportMailAttempt> {
    if (write)
      await tx.$queryRaw`SELECT id FROM core.support_mail_attempts WHERE id=${id}::uuid FOR UPDATE`
    else
      await tx.$queryRaw`SELECT id FROM core.support_mail_attempts WHERE id=${id}::uuid FOR SHARE`
    const row = await tx.supportMailAttempt.findUnique({ where: { id } })
    if (!row || row.actorUserId !== actor.sub || row.targetUserId !== targetId)
      throw this.notFound()
    return row
  }

  notFound(): AppException {
    return new AppException('Not found', 404, ResourceErrorCode.RESOURCE_NOT_FOUND)
  }
  private forbidden(): ForbiddenException {
    return new ForbiddenException('Current platform session required')
  }
}
