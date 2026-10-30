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
  flowProofWindowSeconds,
  readFlowProofs,
} from './mfa-flow-state.js'
import { requiredMfaProofs } from './mfa-policy.js'
import { MfaProofRepository } from './mfa-proof.repository.js'
import { MfaSecurityEvents } from './mfa-security-events.service.js'
import { MfaSourceLimiterService } from './mfa-source-limiter.service.js'
import { mfaDatabaseClock } from './mfa-transaction.js'

export interface FlowVerification {
  outcome:
    | 'verified'
    | 'proof_required'
    | 'wrong_code'
    | 'attempts_exhausted'
    | 'restart_required'
    | 'unavailable'
    | 'limited'
  requiredProofs?: Array<'password' | 'second_factor'>
  retryAfter?: number
}
const storedOutcome = z
  .object({ outcome: z.enum(['verified', 'wrong_code', 'attempts_exhausted']) })
  .strict()

/** No family issuance, password validation, source substitution or UI authority lives here. */
@Injectable()
export class MfaFlowVerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly proofs: MfaProofRepository,
    private readonly sourceLimiter: MfaSourceLimiterService,
    private readonly events: MfaSecurityEvents
  ) {}

  async submit(
    request: FlowRequest,
    operationId: string,
    proof: unknown,
    source: string
  ): Promise<FlowVerification> {
    z.string().uuid().parse(operationId)
    await this.sourceLimiter.consume('verify', source)
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const locked = await lockMfaFlow(tx, request)
          if (!locked) return { outcome: 'restart_required' }
          return this.verifyLocked(tx, locked, operationId, proof)
        },
        { maxWait: 2000, timeout: 4000 }
      )
    } catch (error) {
      // An elapsed deadline rolls proof consumption back, not a committed wrong-code charge.
      if (error instanceof ExpiredDuringVerification) return { outcome: 'restart_required' }
      throw error
    }
  }

  private async verifyLocked(
    tx: Prisma.TransactionClient,
    locked: LockedMfaFlow,
    operationId: string,
    input: unknown
  ): Promise<FlowVerification> {
    const { flow, source } = locked
    const protocol = await tx.mfaProtocol.findUnique({ where: { id: 'platform' } })
    if (protocol?.state !== 'active' || protocol.version !== 1) return { outcome: 'unavailable' }
    const account = await tx.mfaAccount.findUniqueOrThrow({ where: { userId: flow.userId } })
    const factor = await tx.mfaFactor.findUnique({ where: { userId: flow.userId } })
    if (!factor || account.emergencyRequired || !account.setupComplete)
      return { outcome: 'restart_required' }
    const data = readFlowProofs(flow.data)
    const scope = {
      flowId: flow.id,
      sourceFamilyId: flow.sourceFamilyId,
      source,
      codeGeneration: account.codeGeneration,
    }
    const now = await mfaDatabaseClock(tx)
    assertFlowDeadline(locked, now)
    const window = flowProofWindowSeconds(flow)
    const required = requiredMfaProofs(resolveFlowProofs(data, scope), factor.version, now, window)
    const previous = await tx.mfaOperation.findUnique({ where: { id: operationId } })
    if (previous) {
      const result = storedOutcome.safeParse(previous.result)
      if (previous.flowId !== flow.id || previous.kind !== 'verify_factor' || !result.success)
        return { outcome: 'restart_required' }
      return { ...result.data, requiredProofs: required }
    }
    if (
      !required.includes('second_factor') ||
      (flow.authorityKind === 'identity' && required.includes('password'))
    ) {
      return { outcome: required.length ? 'proof_required' : 'verified', requiredProofs: required }
    }
    const budget = await readFailureBudget(tx, flow.userId, now)
    if (!budget.allowed) return { outcome: 'limited', retryAfter: budget.retryAfter }
    const parsed = mfaProofSchema.safeParse(input)
    const verified = parsed.success
      ? await this.proofs.consumeLocked(tx, flow.userId, account.securityVersion, parsed.data)
      : null
    const completedAt = await mfaDatabaseClock(tx)
    assertFlowDeadline(locked, completedAt)
    if (!verified) {
      await recordFactorFailure(tx, flow.id, flow.userId, budget, completedAt)
      const outcome = flow.attempts + 1 >= 5 ? 'attempts_exhausted' : 'wrong_code'
      await this.record(tx, flow.id, operationId, outcome)
      await this.events.failed(tx, flow, operationId)
      assertFlowDeadline(locked, await mfaDatabaseClock(tx))
      return { outcome }
    }
    data.secondFactor = {
      eventId: verified.eventId,
      method: verified.method,
      verifiedAt: verified.verifiedAt.toISOString(),
      origin: { kind: 'flow', flowId: flow.id },
      factorVersion: verified.factorVersion,
      ...(verified.recoveryGeneration !== undefined && {
        recoveryGeneration: verified.recoveryGeneration,
      }),
    }
    await tx.mfaFlow.update({
      where: { id: flow.id },
      data: { data: { ...flowData(flow.data), proofs: data } },
    })
    await this.record(tx, flow.id, operationId, 'verified')
    await this.events.verified(tx, flow, operationId, verified)
    const finalNow = await mfaDatabaseClock(tx)
    assertFlowDeadline(locked, finalNow)
    return {
      outcome: 'verified',
      requiredProofs: requiredMfaProofs(
        resolveFlowProofs(data, scope),
        factor.version,
        finalNow,
        window
      ),
    }
  }

  private async record(
    tx: Prisma.TransactionClient,
    flowId: string,
    id: string,
    outcome: 'verified' | 'wrong_code' | 'attempts_exhausted'
  ): Promise<void> {
    await tx.mfaOperation.create({
      data: { id, flowId, kind: 'verify_factor', result: { outcome } },
    })
  }
}
