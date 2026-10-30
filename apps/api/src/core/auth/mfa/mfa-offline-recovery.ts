import { randomUUID } from 'node:crypto'

import { z } from 'zod'

import {
  ForbiddenException,
  ServiceUnavailableException,
} from '../../../common/exceptions/index.js'
import type { PrismaClient } from '../../../generated/prisma/client.js'

import { accountRequiresMfa } from './mfa-account-policy.js'
import { advanceAccountSecurity } from './mfa-invalidation.js'
import { requireOfflineMfaAuthority } from './mfa-offline-authority.js'
import { recoveryTicketHash } from './mfa-recovery-ticket.js'
import { mfaCredential } from './mfa-secrets.js'
import { MfaSecurityEvents } from './mfa-security-events.service.js'
import { lockMfaAccounts, mfaDatabaseClock } from './mfa-transaction.js'

const resetInput = z
  .object({
    userId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9_-]+$/),
    reason: z
      .string()
      .trim()
      .min(8)
      .max(256)
      .regex(/^[\p{L}\p{M}\p{N}\p{P}\p{S}\p{Zs}]+$/u),
    confirmation: z.string().max(140),
  })
  .strict()

/** CLI-only transaction primitive. Its caller must verify private TTY before prompting or displaying the one-time ticket. */
export class MfaOfflineRecovery {
  constructor(
    private readonly db: PrismaClient,
    private readonly events: MfaSecurityEvents
  ) {}

  async issue(input: z.infer<typeof resetInput>): Promise<{
    userId: string
    ticket: string
    expiresAt: Date
    operationId: string
  }> {
    const parsed = resetInput.parse(input)
    if (parsed.confirmation !== `RESET ${parsed.userId}`)
      throw new ForbiddenException('Offline recovery confirmation required')
    return this.db.$transaction(
      async (tx) => {
        const actor = await requireOfflineMfaAuthority(tx)
        const protocol = await tx.mfaProtocol.findUnique({ where: { id: 'platform' } })
        if (protocol?.state !== 'active' || protocol.version !== 1)
          throw new ServiceUnavailableException(
            'Offline recovery requires the active supported MFA protocol'
          )
        await lockMfaAccounts(tx, [parsed.userId])
        const users = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM core.users WHERE id = ${parsed.userId} FOR UPDATE`
        if (!users.length) throw new ForbiddenException('Recovery account unavailable')
        const user = await tx.user.findUniqueOrThrow({ where: { id: parsed.userId } })
        const account = await tx.mfaAccount.findUnique({ where: { userId: user.id } })
        const factor = await tx.mfaFactor.findUnique({ where: { userId: user.id } })
        if (!user.passwordHash)
          throw new ForbiddenException('Establish a local password before offline recovery')
        if (
          !accountRequiresMfa({
            systemRole: user.systemRole,
            required: account?.required ?? false,
            emergencyRequired: account?.emergencyRequired ?? false,
            factorVersion: factor?.version ?? null,
          })
        )
          throw new ForbiddenException('Account is outside MFA recovery policy')
        const version = await advanceAccountSecurity(tx, user.id)
        await tx.mfaAccount.update({
          where: { userId: user.id },
          data: {
            required: true,
            setupComplete: false,
            emergencyRequired: true,
            codeGeneration: { increment: 1 },
          },
        })
        await tx.mfaFlow.updateMany({
          where: { userId: user.id, state: { in: ['open', 'committed'] } },
          data: { state: 'retired' },
        })
        await tx.mfaFactor.deleteMany({ where: { userId: user.id } })
        await tx.mfaRecoveryCode.deleteMany({ where: { userId: user.id } })
        const ticket = mfaCredential()
        const operationId = randomUUID()
        const now = await mfaDatabaseClock(tx)
        const expiresAt = new Date(now.getTime() + 900_000)
        const data = {
          id: randomUUID(),
          credentialHash: recoveryTicketHash(ticket)!,
          securityVersion: version,
          expiresAt,
          consumedAt: null,
          consumedByFlowId: null,
          createdAt: now,
        }
        await tx.mfaRecoveryTicket.upsert({
          where: { userId: user.id },
          create: { ...data, userId: user.id },
          update: data,
        })
        await this.events.recoveryReset(tx, user.id, operationId, actor, parsed.reason, now)
        if ((await requireOfflineMfaAuthority(tx)) !== actor)
          throw new ForbiddenException('Offline recovery database authority changed')
        if (expiresAt <= (await mfaDatabaseClock(tx)))
          throw new Error('Offline recovery deadline elapsed')
        return { userId: user.id, ticket, expiresAt, operationId }
      },
      { maxWait: 2000, timeout: 4000 }
    )
  }
}
