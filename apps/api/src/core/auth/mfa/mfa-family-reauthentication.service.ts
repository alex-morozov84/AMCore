import { Injectable } from '@nestjs/common'
import { z } from 'zod'

import type { Prisma } from '../../../generated/prisma/client.js'
import { PrismaService } from '../../../prisma/index.js'

import { commitFamilyEvidence } from './mfa-family-evidence.js'
import { type FlowRequest, type LockedMfaFlow, lockMfaFlow } from './mfa-flow-lock.js'
import { resolveFlowProofs } from './mfa-flow-proofs.js'
import {
  assertFlowDeadline,
  ExpiredDuringVerification,
  flowProofWindowSeconds,
  readFlowProofs,
} from './mfa-flow-state.js'
import { type MfaEvidence, requiredMfaProofs } from './mfa-policy.js'
import { MfaSecurityEvents } from './mfa-security-events.service.js'
import { mfaDatabaseClock } from './mfa-transaction.js'

type RequiredProof = 'password' | 'second_factor'
export type FamilyReauthentication =
  | { outcome: 'completed' | 'proof_required'; requiredProofs: RequiredProof[] }
  | { outcome: 'restart_required' | 'unavailable' }
class FreshnessChanged extends Error {
  constructor(readonly requiredProofs: RequiredProof[]) {
    super('Reauthentication proof changed')
  }
}

/** Commits evidence only into the exact source F. Never issues or selects another family. */
@Injectable()
export class MfaFamilyReauthenticationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: MfaSecurityEvents
  ) {}

  async complete(request: FlowRequest, operationId: string): Promise<FamilyReauthentication> {
    z.string().uuid().parse(operationId)
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const locked = await lockMfaFlow(tx, request)
          if (!locked || locked.flow.purpose !== 'reauthenticate' || !locked.source)
            return { outcome: 'restart_required' }
          return this.completeLocked(tx, locked, operationId)
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

  private async completeLocked(
    tx: Prisma.TransactionClient,
    locked: LockedMfaFlow,
    operationId: string
  ): Promise<FamilyReauthentication> {
    const protocol = await tx.mfaProtocol.findUnique({ where: { id: 'platform' } })
    if (protocol?.state !== 'active' || protocol.version !== 1) return { outcome: 'unavailable' }
    const account = await tx.mfaAccount.findUniqueOrThrow({ where: { userId: locked.flow.userId } })
    const factor = await tx.mfaFactor.findUnique({ where: { userId: locked.flow.userId } })
    if (!factor || !account.setupComplete || account.emergencyRequired)
      return { outcome: 'restart_required' }
    const proofs = readFlowProofs(locked.flow.data)
    const evidence = resolveFlowProofs(proofs, {
      flowId: locked.flow.id,
      sourceFamilyId: locked.flow.sourceFamilyId,
      source: locked.source,
      codeGeneration: account.codeGeneration,
    })
    const now = await mfaDatabaseClock(tx)
    assertFlowDeadline(locked, now)
    const window = flowProofWindowSeconds(locked.flow)
    const required = requiredMfaProofs(evidence, factor.version, now, window)
    const previous = await tx.mfaOperation.findUnique({ where: { id: operationId } })
    if (
      previous &&
      (previous.flowId !== locked.flow.id || previous.kind !== 'reauthenticate_family')
    )
      return { outcome: 'restart_required' }
    // Retries report current proof state; they never renew timestamps or write evidence again.
    if (previous) {
      const currentRequired = requiredMfaProofs(locked.source!, factor.version, now, window)
      return {
        outcome: currentRequired.length ? 'proof_required' : 'completed',
        requiredProofs: currentRequired,
      }
    }
    if (required.length) return { outcome: 'proof_required', requiredProofs: required }
    const session = await tx.session.findFirst({
      where: {
        familyId: locked.source!.id,
        userId: locked.flow.userId,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      select: { id: true, expiresAt: true },
    })
    if (!session) return { outcome: 'restart_required' }
    await commitFamilyEvidence(tx, locked, evidence)
    await tx.mfaOperation.create({
      data: {
        id: operationId,
        flowId: locked.flow.id,
        kind: 'reauthenticate_family',
        result: { outcome: 'completed', familyId: locked.source!.id },
      },
    })
    await this.events.reauthenticated(tx, locked.flow, session.id)
    const finalNow = await mfaDatabaseClock(tx)
    assertFlowDeadline(locked, finalNow)
    if (session.expiresAt <= finalNow) throw new ExpiredDuringVerification()
    const finalRequired = requiredMfaProofs(
      evidence as MfaEvidence,
      factor.version,
      finalNow,
      window
    )
    if (finalRequired.length) throw new FreshnessChanged(finalRequired)
    return { outcome: 'completed', requiredProofs: [] }
  }
}
