import { Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'

import type { MfaSettingsStartLookup, MfaSettingsStartStatus } from '@amcore/shared'

import { PrismaService } from '../../../prisma/index.js'

import type { BrowserRequestBinding } from './browser-binding.js'
import { mfaSourceSessionClaimsSchema } from './mfa-session-claims.js'
import { lockSettingsSource, settingsSourceChanged } from './mfa-settings-source.js'
import { mfaDatabaseClock } from './mfa-transaction.js'

@Injectable()
export class MfaSettingsStartRecoveryService {
  constructor(
    private readonly db: PrismaService,
    private readonly jwt: JwtService
  ) {}

  async resolve(
    token: string,
    binding: BrowserRequestBinding,
    input: MfaSettingsStartLookup,
    abandon: boolean
  ): Promise<MfaSettingsStartStatus> {
    const claims = mfaSourceSessionClaimsSchema.parse(
      this.jwt.verify(token, { algorithms: ['HS256'] })
    )
    return this.db.$transaction(
      async (tx) => {
        const source = await lockSettingsSource(tx, claims, binding)
        const receipt = await tx.mfaSettingsStartReceipt.findUnique({
          where: { operationId: input.operationId },
        })
        const scope = {
          userId: claims.sub,
          sourceFamilyId: claims.fid,
          sourceSecurityVersion: claims.securityVersion,
          browserContextId: binding.contextId,
          generation: binding.generation,
          audience: binding.audience,
          bindingHash: binding.bindingHash,
          purpose: input.purpose,
        }
        if (
          receipt &&
          (Object.entries(scope).some(
            ([key, value]) => receipt[key as keyof typeof receipt] !== value
          ) ||
            (input.startNotAfter !== undefined &&
              receipt.startNotAfter.toISOString() !== input.startNotAfter))
        )
          throw settingsSourceChanged()
        if (receipt?.state === 'abandoned') return { state: 'abandoned' }
        if (receipt && receipt.expiresAt <= source.now) return { state: 'expired' }
        const progressed = receipt?.flowId
          ? (await tx.mfaOperation.count({
              where: { flowId: receipt.flowId, kind: { not: 'start_session_flow' } },
            })) > 0
          : false
        if (!abandon)
          return receipt
            ? {
                state: 'created',
                flowId: receipt.flowId ?? undefined,
                expiresAt: receipt.expiresAt.toISOString(),
                progressed,
              }
            : { state: 'not_found' }
        if (progressed) return { state: 'advanced_unrecoverable' }
        const deadline =
          receipt?.startNotAfter ?? new Date(input.startNotAfter ?? source.now.getTime() + 30000)
        if (!receipt && deadline.getTime() > source.now.getTime() + 30000)
          throw settingsSourceChanged()
        if (receipt?.flowId) {
          const retired = await tx.mfaFlow.updateMany({
            where: {
              id: receipt.flowId,
              userId: claims.sub,
              sourceFamilyId: claims.fid,
              state: 'open',
            },
            data: { state: 'retired' },
          })
          if (retired.count !== 1) return { state: 'advanced_unrecoverable' }
        }
        await tx.mfaSettingsStartReceipt.upsert({
          where: { operationId: input.operationId },
          update: { state: 'abandoned' },
          create: {
            ...scope,
            operationId: input.operationId,
            sourceSessionId: claims.sid,
            startNotAfter: deadline,
            state: 'abandoned',
            expiresAt: new Date(
              Math.min(
                source.family.expiresAt.getTime(),
                source.context.expiresAt.getTime(),
                Math.max(deadline.getTime(), source.now.getTime() + 900000)
              )
            ),
          },
        })
        const finalNow = await mfaDatabaseClock(tx)
        if (
          claims.exp * 1000 <= finalNow.getTime() ||
          source.family.expiresAt <= finalNow ||
          source.context.expiresAt <= finalNow
        )
          throw settingsSourceChanged()
        return { state: 'abandoned' }
      },
      { maxWait: 2000, timeout: 4000 }
    )
  }
}
