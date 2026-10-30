import { Injectable } from '@nestjs/common'
import { z } from 'zod'

import { mfaProofSchema } from '@amcore/shared'

import type { Prisma } from '../../../generated/prisma/client.js'
import { PrismaService } from '../../../prisma/index.js'

import { readFailureBudget, recordFactorFailure } from './mfa-account-budgets.js'
import {
  authorizeSeedDraft,
  DraftFreshnessChanged,
  draftRequiredProofs,
} from './mfa-draft-authorization.js'
import { MfaEncryptionService } from './mfa-encryption.service.js'
import { type FlowRequest, type LockedMfaFlow, lockMfaFlow } from './mfa-flow-lock.js'
import { assertFlowDeadline, ExpiredDuringVerification } from './mfa-flow-state.js'
import { MfaProofRepository } from './mfa-proof.repository.js'
import { MfaSecurityEvents } from './mfa-security-events.service.js'
import { readSeedDraft } from './mfa-seed-draft.js'
import { type SetupSuccessor, writeSetupSuccessor } from './mfa-setup-successor-writer.js'
import { MfaSourceLimiterService } from './mfa-source-limiter.service.js'
import { verifyTotp } from './mfa-totp.js'
import { mfaDatabaseClock } from './mfa-transaction.js'

type BindingResult =
  | { outcome: 'bound'; successor: SetupSuccessor }
  | { outcome: 'proof_required'; requiredProofs: Array<'password' | 'second_factor'> }
  | { outcome: 'limited'; retryAfter: number }
  | {
      outcome:
        'wrong_code' | 'attempts_exhausted' | 'restart_required' | 'already_bound' | 'unavailable'
    }
const negative = z.object({ outcome: z.enum(['wrong_code', 'attempts_exhausted']) }).strict()

/** Binding is durable even if its only plaintext-code/successor response is lost. */
@Injectable()
export class MfaFactorBindingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: MfaEncryptionService,
    private readonly proofs: MfaProofRepository,
    private readonly sourceLimiter: MfaSourceLimiterService,
    private readonly events: MfaSecurityEvents
  ) {}

  async bind(
    request: FlowRequest,
    operationId: string,
    input: unknown,
    source: string
  ): Promise<BindingResult> {
    z.string().uuid().parse(operationId)
    await this.sourceLimiter.consume('verify', source)
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const locked = await lockMfaFlow(tx, request)
          if (!locked) return { outcome: 'restart_required' }
          return this.bindLocked(tx, request, locked, operationId, input)
        },
        { maxWait: 2000, timeout: 4000 }
      )
    } catch (error) {
      if (error instanceof ExpiredDuringVerification) return { outcome: 'restart_required' }
      if (error instanceof DraftFreshnessChanged)
        return { outcome: 'proof_required', requiredProofs: error.requiredProofs }
      throw error
    }
  }

  private async bindLocked(
    tx: Prisma.TransactionClient,
    request: FlowRequest,
    locked: LockedMfaFlow,
    operationId: string,
    input: unknown
  ): Promise<BindingResult> {
    const { flow } = locked
    const authority = await authorizeSeedDraft(tx, locked)
    if (authority.outcome !== 'authorized') return authority
    const draft = readSeedDraft(flow.data)
    if (!draft || new Date(draft.expiresAt) <= authority.now) return { outcome: 'restart_required' }
    const previous = await tx.mfaOperation.findUnique({ where: { id: operationId } })
    if (previous) {
      const parsed = negative.safeParse(previous.result)
      return previous.flowId === flow.id && previous.kind === 'verify_seed' && parsed.success
        ? parsed.data
        : { outcome: 'restart_required' }
    }
    const budget = await readFailureBudget(tx, flow.userId, authority.now)
    if (!budget.allowed) return { outcome: 'limited', retryAfter: budget.retryAfter }
    const parsed = mfaProofSchema.safeParse(input)
    const now = await mfaDatabaseClock(tx)
    assertFlowDeadline(locked, now)
    if (new Date(draft.expiresAt) <= now) return { outcome: 'restart_required' }
    const secret = this.encryption.decrypt(
      flow.userId,
      draft.factorId,
      draft.keyId,
      draft.encryptedSeed
    )
    const checked =
      parsed.success && parsed.data.method === 'totp'
        ? await verifyTotp(secret, parsed.data.code, -1n, now)
        : { valid: false }
    if (!checked.valid || !('timeStep' in checked) || checked.timeStep === undefined) {
      await recordFactorFailure(tx, flow.id, flow.userId, budget, now)
      const outcome = flow.attempts + 1 >= 5 ? 'attempts_exhausted' : 'wrong_code'
      await tx.mfaOperation.create({
        data: { id: operationId, flowId: flow.id, kind: 'verify_seed', result: { outcome } },
      })
      await this.events.failed(tx, flow, operationId)
      assertFlowDeadline(locked, await mfaDatabaseClock(tx))
      return { outcome }
    }
    const successor = await writeSetupSuccessor(
      tx,
      request,
      locked,
      authority.evidence,
      draft,
      operationId,
      checked.timeStep,
      now,
      this.proofs
    )
    await this.events.factorBound(tx, flow, operationId, authority.factorVersion + 1, now)
    const finalNow = await mfaDatabaseClock(tx)
    assertFlowDeadline(locked, finalNow)
    if (new Date(draft.expiresAt) <= finalNow) throw new ExpiredDuringVerification()
    const required = draftRequiredProofs(
      authority.evidence,
      flow.purpose,
      authority.factorVersion,
      finalNow
    )
    if (required.length) throw new DraftFreshnessChanged(required)
    return { outcome: 'bound', successor }
  }
}
