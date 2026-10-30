import { Injectable } from '@nestjs/common'
import { z } from 'zod'

import type { Prisma, User } from '../../../generated/prisma/client.js'
import { PrismaService } from '../../../prisma/index.js'

import { readFailureBudget, recordFactorFailure } from './mfa-account-budgets.js'
import { type FlowRequest, type LockedMfaFlow, lockMfaFlow } from './mfa-flow-lock.js'
import { assertFlowDeadline, ExpiredDuringVerification } from './mfa-flow-state.js'
import {
  MfaPasswordIdentityService,
  type VerifiedPasswordIdentity,
} from './mfa-password-identity.service.js'
import { writeRecoveryEnrollment } from './mfa-recovery-enrollment-writer.js'
import { recoveryTicketHash } from './mfa-recovery-ticket.js'
import { MfaSecurityEvents } from './mfa-security-events.service.js'
import { MfaSourceLimiterService } from './mfa-source-limiter.service.js'
import { mfaDatabaseClock } from './mfa-transaction.js'

type Snapshot = Pick<User, 'id' | 'email' | 'emailCanonical' | 'passwordHash' | 'systemRole'> & {
  version: number
}
const negative = z
  .object({ outcome: z.enum(['wrong_password', 'wrong_ticket', 'attempts_exhausted']) })
  .strict()
export type TicketRedemption =
  | { outcome: 'enrollment'; request: FlowRequest; expiresAt: Date }
  | z.infer<typeof negative>
  | { outcome: 'limited'; retryAfter: number }
  | { outcome: 'restart_required' | 'unavailable' }

/** Password work stays outside locks. Ticket consumption and its restricted successor commit together. */
@Injectable()
export class MfaTicketRedemptionService {
  constructor(
    private readonly db: PrismaService,
    private readonly passwords: MfaPasswordIdentityService,
    private readonly sourceLimiter: MfaSourceLimiterService,
    private readonly events: MfaSecurityEvents
  ) {}

  async redeem(
    request: FlowRequest,
    operationId: string,
    password: string,
    ticket: string,
    source: string
  ): Promise<TicketRedemption> {
    z.string().uuid().parse(operationId)
    z.string().min(1).max(128).parse(password)
    z.string().max(256).parse(ticket)
    await this.sourceLimiter.consume('verify', source)
    try {
      const before = await this.db.$transaction<
        { result: TicketRedemption } | { snapshot: Snapshot }
      >(
        async (tx) => {
          const locked = await lockMfaFlow(tx, request, { recoveryPending: true })
          const refusal = await this.preflight(tx, locked, operationId)
          if (refusal || !locked)
            return { result: refusal ?? { outcome: 'restart_required' as const } }
          const user = await tx.user.findUniqueOrThrow({
            where: { id: locked.flow.userId },
            select: {
              id: true,
              email: true,
              emailCanonical: true,
              passwordHash: true,
              systemRole: true,
            },
          })
          return { snapshot: { ...user, version: locked.flow.securityVersion } }
        },
        { maxWait: 2000, timeout: 4000 }
      )
      if ('result' in before) return before.result
      const identity = await this.passwords.verify(before.snapshot.email, password, source)
      return await this.db.$transaction(
        (tx) => this.commit(tx, request, operationId, ticket, before.snapshot, identity),
        { maxWait: 2000, timeout: 4000 }
      )
    } catch (error) {
      if (error instanceof ExpiredDuringVerification) return { outcome: 'restart_required' }
      throw error
    }
  }

  private async preflight(
    tx: Prisma.TransactionClient,
    locked: LockedMfaFlow | null,
    operationId: string
  ): Promise<TicketRedemption | null> {
    if (!locked || locked.flow.authorityKind !== 'recovery_pending')
      return { outcome: 'restart_required' }
    const protocol = await tx.mfaProtocol.findUnique({ where: { id: 'platform' } })
    if (protocol?.state !== 'active' || protocol.version !== 1) return { outcome: 'unavailable' }
    const previous = await tx.mfaOperation.findUnique({ where: { id: operationId } })
    if (previous) {
      const result = negative.safeParse(previous.result)
      return previous.flowId === locked.flow.id &&
        previous.kind === 'redeem_recovery_ticket' &&
        result.success
        ? result.data
        : { outcome: 'restart_required' }
    }
    const budget = await readFailureBudget(tx, locked.flow.userId, await mfaDatabaseClock(tx))
    return budget.allowed ? null : { outcome: 'limited', retryAfter: budget.retryAfter }
  }

  private async commit(
    tx: Prisma.TransactionClient,
    request: FlowRequest,
    operationId: string,
    input: string,
    before: Snapshot,
    identity: VerifiedPasswordIdentity | null
  ): Promise<TicketRedemption> {
    const locked = await lockMfaFlow(tx, request, { recoveryPending: true })
    const refusal = await this.preflight(tx, locked, operationId)
    if (refusal || !locked) return refusal ?? { outcome: 'restart_required' }
    const user = await tx.user.findUniqueOrThrow({ where: { id: before.id } })
    if (
      locked.flow.userId !== before.id ||
      locked.flow.securityVersion !== before.version ||
      user.passwordHash !== before.passwordHash ||
      user.emailCanonical !== before.emailCanonical ||
      user.systemRole !== before.systemRole
    )
      return { outcome: 'restart_required' }
    if (!identity) {
      await this.events.passwordFailed(tx, locked.flow)
      await tx.mfaOperation.create({
        data: {
          id: operationId,
          flowId: locked.flow.id,
          kind: 'redeem_recovery_ticket',
          result: { outcome: 'wrong_password' },
        },
      })
      assertFlowDeadline(locked, await mfaDatabaseClock(tx))
      return { outcome: 'wrong_password' }
    }
    const now = await mfaDatabaseClock(tx)
    assertFlowDeadline(locked, now)
    if (
      !identity.matches(user, before.version) ||
      identity.verifiedAt > now ||
      now.getTime() - identity.verifiedAt.getTime() > 600_000
    )
      return { outcome: 'restart_required' }
    const ticket = await tx.mfaRecoveryTicket.findUnique({ where: { userId: user.id } })
    if (
      !ticket ||
      ticket.credentialHash !== recoveryTicketHash(input) ||
      ticket.securityVersion !== before.version ||
      ticket.consumedAt ||
      ticket.expiresAt <= now
    ) {
      const budget = await readFailureBudget(tx, user.id, now)
      await recordFactorFailure(tx, locked.flow.id, user.id, budget, now)
      const outcome = locked.flow.attempts + 1 >= 5 ? 'attempts_exhausted' : 'wrong_ticket'
      await tx.mfaOperation.create({
        data: {
          id: operationId,
          flowId: locked.flow.id,
          kind: 'redeem_recovery_ticket',
          result: { outcome },
        },
      })
      await this.events.failed(tx, locked.flow, operationId)
      assertFlowDeadline(locked, await mfaDatabaseClock(tx))
      return { outcome }
    }
    const successor = await writeRecoveryEnrollment(
      tx,
      locked,
      request,
      ticket,
      operationId,
      identity.verifiedAt,
      now
    )
    if (!successor) return { outcome: 'restart_required' }
    await this.events.ticketRedeemed(tx, locked.flow, operationId)
    const finalNow = await mfaDatabaseClock(tx)
    if (
      successor.expiresAt <= finalNow ||
      finalNow.getTime() - identity.verifiedAt.getTime() > 600_000
    )
      throw new ExpiredDuringVerification()
    return { outcome: 'enrollment', ...successor }
  }
}
