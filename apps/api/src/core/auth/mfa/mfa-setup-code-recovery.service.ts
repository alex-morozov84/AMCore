import { Injectable } from '@nestjs/common'
import { z } from 'zod'

import { mfaProofSchema } from '@amcore/shared'

import type { Prisma } from '../../../generated/prisma/client.js'
import { PrismaService } from '../../../prisma/index.js'

import { readFailureBudget, recordFactorFailure } from './mfa-account-budgets.js'
import { type FlowRequest, type LockedMfaFlow, lockMfaFlow } from './mfa-flow-lock.js'
import { resolveFlowProofs } from './mfa-flow-proofs.js'
import {
  assertFlowDeadline,
  ExpiredDuringVerification,
  flowData,
  readFlowProofs,
} from './mfa-flow-state.js'
import { requiredMfaProofs } from './mfa-policy.js'
import { MfaProofRepository } from './mfa-proof.repository.js'
import { MfaSecurityEvents } from './mfa-security-events.service.js'
import { MfaSourceLimiterService } from './mfa-source-limiter.service.js'
import { mfaDatabaseClock } from './mfa-transaction.js'

type RequiredProof = 'password' | 'second_factor'
type CodeRecovery =
  | { outcome: 'codes'; codes: string[]; generation: number }
  | { outcome: 'already_generated'; generation: number }
  | { outcome: 'limited'; retryAfter: number }
  | { outcome: 'proof_required'; requiredProofs: RequiredProof[] }
  | {
      outcome:
        | 'restart_required'
        | 'unavailable'
        | 'generation_changed'
        | 'wrong_code'
        | 'attempts_exhausted'
    }
const saved = z.object({ generation: z.number().int().positive() }).strict()
const failed = z.object({ outcome: z.enum(['wrong_code', 'attempts_exhausted']) }).strict()
class FreshnessChanged extends Error {
  constructor(readonly requiredProofs: RequiredProof[]) {
    super('Setup code recovery proof changed')
  }
}

/** Lost first-setup codes require the bound app's NEXT unused TOTP, never a plaintext replay. */
@Injectable()
export class MfaSetupCodeRecoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly proofs: MfaProofRepository,
    private readonly sourceLimiter: MfaSourceLimiterService,
    private readonly events: MfaSecurityEvents
  ) {}

  async recover(
    request: FlowRequest,
    operationId: string,
    input: unknown,
    source: string
  ): Promise<CodeRecovery> {
    z.string().uuid().parse(operationId)
    await this.sourceLimiter.consume('verify', source)
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const locked = await lockMfaFlow(tx, request)
          if (
            !locked ||
            locked.flow.purpose !== 'initial_setup' ||
            !['identity', 'setup_successor'].includes(locked.flow.authorityKind)
          )
            return { outcome: 'restart_required' }
          return this.recoverLocked(tx, locked, operationId, input)
        },
        { maxWait: 2000, timeout: 4000 }
      )
    } catch (error) {
      if (error instanceof ExpiredDuringVerification) return { outcome: 'restart_required' }
      if (error instanceof FreshnessChanged)
        return { outcome: 'proof_required', requiredProofs: error.requiredProofs }
      throw error
    }
  }

  private async recoverLocked(
    tx: Prisma.TransactionClient,
    locked: LockedMfaFlow,
    operationId: string,
    input: unknown
  ): Promise<CodeRecovery> {
    const { flow } = locked
    const protocol = await tx.mfaProtocol.findUnique({ where: { id: 'platform' } })
    if (protocol?.state !== 'active' || protocol.version !== 1) return { outcome: 'unavailable' }
    const account = await tx.mfaAccount.findUniqueOrThrow({ where: { userId: flow.userId } })
    const factor = await tx.mfaFactor.findUnique({ where: { userId: flow.userId } })
    if (!factor || !account.required || account.setupComplete || account.emergencyRequired)
      return { outcome: 'restart_required' }
    const previous = await tx.mfaOperation.findUnique({ where: { id: operationId } })
    if (previous) {
      if (previous.flowId !== flow.id) return { outcome: 'restart_required' }
      const result = saved.safeParse(previous.result)
      if (previous.kind === 'recover_setup_codes' && result.success)
        return result.data.generation === account.codeGeneration
          ? { outcome: 'already_generated', generation: result.data.generation }
          : { outcome: 'generation_changed' }
      const negative = failed.safeParse(previous.result)
      return previous.kind === 'recover_setup_codes_failed' && negative.success
        ? negative.data
        : { outcome: 'restart_required' }
    }
    const data = readFlowProofs(flow.data)
    const scope = {
      flowId: flow.id,
      sourceFamilyId: null,
      source: null,
      codeGeneration: account.codeGeneration,
    }
    const now = await mfaDatabaseClock(tx)
    assertFlowDeadline(locked, now)
    if (requiredMfaProofs(resolveFlowProofs(data, scope), factor.version, now).includes('password'))
      return { outcome: 'proof_required', requiredProofs: ['password'] }
    const budget = await readFailureBudget(tx, flow.userId, now)
    if (!budget.allowed) return { outcome: 'limited', retryAfter: budget.retryAfter }
    const parsed = mfaProofSchema.safeParse(input)
    const verified =
      parsed.success && parsed.data.method === 'totp'
        ? await this.proofs.consumeLocked(tx, flow.userId, account.securityVersion, parsed.data)
        : null
    if (!verified) {
      await recordFactorFailure(tx, flow.id, flow.userId, budget, now)
      const outcome = flow.attempts + 1 >= 5 ? 'attempts_exhausted' : 'wrong_code'
      await tx.mfaOperation.create({
        data: {
          id: operationId,
          flowId: flow.id,
          kind: 'recover_setup_codes_failed',
          result: { outcome },
        },
      })
      await this.events.failed(tx, flow, operationId)
      assertFlowDeadline(locked, await mfaDatabaseClock(tx))
      return { outcome }
    }
    data.secondFactor = {
      eventId: verified.eventId,
      method: 'totp',
      verifiedAt: verified.verifiedAt.toISOString(),
      factorVersion: verified.factorVersion,
      origin: { kind: 'flow', flowId: flow.id },
    }
    const replacement = await this.proofs.replaceBackupCodesLocked(
      tx,
      flow.userId,
      account.securityVersion,
      account.codeGeneration
    )
    if (!replacement) throw new Error('Locked setup generation changed')
    await tx.mfaFlow.update({
      where: { id: flow.id },
      data: {
        data: {
          ...flowData(flow.data),
          proofs: data,
          setup: { generation: replacement.generation, acknowledged: false },
        },
      },
    })
    await tx.mfaOperation.create({
      data: {
        id: operationId,
        flowId: flow.id,
        kind: 'recover_setup_codes',
        result: { generation: replacement.generation },
      },
    })
    await this.events.verified(tx, flow, operationId, verified)
    await this.events.backupCodesChanged(tx, flow, operationId, replacement.generation, now)
    const finalNow = await mfaDatabaseClock(tx)
    assertFlowDeadline(locked, finalNow)
    const required = requiredMfaProofs(
      resolveFlowProofs(data, { ...scope, codeGeneration: replacement.generation }),
      factor.version,
      finalNow
    )
    if (required.length) throw new FreshnessChanged(required)
    return { outcome: 'codes', ...replacement }
  }
}
