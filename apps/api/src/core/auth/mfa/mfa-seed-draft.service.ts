import { randomUUID } from 'node:crypto'

import { Injectable } from '@nestjs/common'
import { z } from 'zod'

import type { Prisma } from '../../../generated/prisma/client.js'
import { PrismaService } from '../../../prisma/index.js'

import { chargeDraftRegeneration } from './mfa-account-budgets.js'
import {
  authorizeSeedDraft,
  DraftFreshnessChanged,
  draftRequiredProofs,
} from './mfa-draft-authorization.js'
import { MfaEncryptionService } from './mfa-encryption.service.js'
import { type FlowRequest, type LockedMfaFlow, lockMfaFlow } from './mfa-flow-lock.js'
import { assertFlowDeadline, ExpiredDuringVerification, flowData } from './mfa-flow-state.js'
import { hasOtherSeedDraft, readSeedDraft } from './mfa-seed-draft.js'
import { MfaSourceLimiterService } from './mfa-source-limiter.service.js'
import { createTotpSecret, totpUri } from './mfa-totp.js'
import { mfaDatabaseClock } from './mfa-transaction.js'

type RequiredProof = 'password' | 'second_factor'
export type SeedDraftResult =
  | { outcome: 'seed'; secret: string; otpauthUri: string; expiresAt: Date }
  | { outcome: 'proof_required'; requiredProofs: RequiredProof[] }
  | { outcome: 'limited'; retryAfter: number }
  | { outcome: 'draft_exists' | 'already_bound' | 'restart_required' | 'unavailable' }

/** Unbound seeds alone grant no authority. Binding and setup acknowledgement are separate commits. */
@Injectable()
export class MfaSeedDraftService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: MfaEncryptionService,
    private readonly sourceLimiter: MfaSourceLimiterService
  ) {}

  async open(
    request: FlowRequest,
    operationId: string,
    regenerate: boolean,
    source: string
  ): Promise<SeedDraftResult> {
    z.string().uuid().parse(operationId)
    await this.sourceLimiter.consume('start', source)
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const locked = await lockMfaFlow(tx, request)
          if (!locked) return { outcome: 'restart_required' }
          return this.openLocked(tx, locked, operationId, regenerate)
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

  private async openLocked(
    tx: Prisma.TransactionClient,
    locked: LockedMfaFlow,
    operationId: string,
    regenerate: boolean
  ): Promise<SeedDraftResult> {
    const { flow } = locked
    const authority = await authorizeSeedDraft(tx, locked)
    if (authority.outcome !== 'authorized') return authority
    const { now } = authority
    const previous = await tx.mfaOperation.findUnique({ where: { id: operationId } })
    let draft = readSeedDraft(flow.data)
    if (
      previous &&
      (previous.flowId !== flow.id ||
        previous.kind !== 'open_seed' ||
        !draft ||
        (previous.result as Prisma.JsonObject).draftId !== draft.id)
    )
      return { outcome: 'restart_required' }
    if (await hasOtherSeedDraft(tx, flow.userId, flow.securityVersion, flow.id, now))
      return { outcome: 'draft_exists' }
    if (!draft || (regenerate && !previous)) {
      if (draft || regenerate) {
        const budget = await chargeDraftRegeneration(tx, flow.userId, now)
        if (!budget.allowed) return { outcome: 'limited', retryAfter: budget.retryAfter }
      }
      const fresh = createTotpSecret(authority.email)
      const factorId = randomUUID()
      draft = {
        id: randomUUID(),
        factorId,
        ...this.encryption.encrypt(flow.userId, factorId, fresh.secret),
        expiresAt: flow.expiresAt.toISOString(),
      }
      await tx.mfaFlow.update({
        where: { id: flow.id },
        data: { data: { ...flowData(flow.data), seedDraft: draft } },
      })
    }
    if (!previous)
      await tx.mfaOperation.create({
        data: {
          id: operationId,
          flowId: flow.id,
          kind: 'open_seed',
          result: { draftId: draft.id },
        },
      })
    // Reopening the same still-unbound seed is allowed; backup-code plaintext has no such read path.
    const secret = this.encryption.decrypt(
      flow.userId,
      draft.factorId,
      draft.keyId,
      draft.encryptedSeed
    )
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
    return {
      outcome: 'seed',
      secret,
      otpauthUri: totpUri(authority.email, secret),
      expiresAt: new Date(draft.expiresAt),
    }
  }
}
