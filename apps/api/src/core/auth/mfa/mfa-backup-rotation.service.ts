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
  flowData,
  readFlowProofs,
} from './mfa-flow-state.js'
import { requiredMfaProofs } from './mfa-policy.js'
import { MfaProofRepository } from './mfa-proof.repository.js'
import { MfaSecurityEvents } from './mfa-security-events.service.js'
import { MfaSourceLimiterService } from './mfa-source-limiter.service.js'
import { mfaDatabaseClock } from './mfa-transaction.js'

type RequiredProof = 'password' | 'second_factor'
export type BackupRotation =
  | { outcome: 'codes'; codes: string[]; generation: number }
  | { outcome: 'already_generated'; generation: number }
  | { outcome: 'proof_required'; requiredProofs: RequiredProof[] }
  | { outcome: 'generation_changed' | 'restart_required' | 'unavailable' }
const resultSchema = z.object({ generation: z.number().int().positive() }).strict()
class FreshnessChanged extends Error {
  constructor(readonly requiredProofs: RequiredProof[]) {
    super('Backup rotation proof changed')
  }
}

/** Ordinary regeneration remains on F. A fresh committed backup proof can replace the last code. */
@Injectable()
export class MfaBackupRotationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly proofs: MfaProofRepository,
    private readonly sourceLimiter: MfaSourceLimiterService,
    private readonly events: MfaSecurityEvents
  ) {}

  async rotate(request: FlowRequest, operationId: string, source: string): Promise<BackupRotation> {
    z.string().uuid().parse(operationId)
    await this.sourceLimiter.consume('verify', source)
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const locked = await lockMfaFlow(tx, request)
          if (!locked || locked.flow.purpose !== 'rotate_codes' || !locked.source)
            return { outcome: 'restart_required' }
          return this.rotateLocked(tx, locked, operationId)
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

  private async rotateLocked(
    tx: Prisma.TransactionClient,
    locked: LockedMfaFlow,
    operationId: string
  ): Promise<BackupRotation> {
    const { flow } = locked
    const protocol = await tx.mfaProtocol.findUnique({ where: { id: 'platform' } })
    if (protocol?.state !== 'active' || protocol.version !== 1) return { outcome: 'unavailable' }
    const account = await tx.mfaAccount.findUniqueOrThrow({ where: { userId: flow.userId } })
    const factor = await tx.mfaFactor.findUnique({ where: { userId: flow.userId } })
    if (!factor || !account.setupComplete || account.emergencyRequired)
      return { outcome: 'restart_required' }
    const previous = await tx.mfaOperation.findUnique({ where: { id: operationId } })
    if (previous) {
      const parsed = resultSchema.safeParse(previous.result)
      if (previous.flowId !== flow.id || previous.kind !== 'rotate_backup_codes' || !parsed.success)
        return { outcome: 'restart_required' }
      return parsed.data.generation === account.codeGeneration
        ? { outcome: 'already_generated', generation: parsed.data.generation }
        : { outcome: 'generation_changed' }
    }
    const evidence = resolveFlowProofs(readFlowProofs(flow.data), {
      flowId: flow.id,
      sourceFamilyId: flow.sourceFamilyId,
      source: locked.source,
      codeGeneration: account.codeGeneration,
    })
    const now = await mfaDatabaseClock(tx)
    assertFlowDeadline(locked, now)
    const required = requiredMfaProofs(evidence, factor.version, now)
    if (required.length) return { outcome: 'proof_required', requiredProofs: required }
    const session = await tx.session.findFirst({
      where: { familyId: locked.source!.id, revokedAt: null, expiresAt: { gt: now } },
      select: { expiresAt: true },
    })
    if (!session) return { outcome: 'restart_required' }
    await commitFamilyEvidence(tx, locked, evidence)
    const replacement = await this.proofs.replaceBackupCodesLocked(
      tx,
      flow.userId,
      account.securityVersion,
      account.codeGeneration
    )
    if (!replacement) throw new Error('Locked backup generation changed')
    await tx.mfaFlow.update({
      where: { id: flow.id },
      data: {
        data: {
          ...flowData(locked.flow.data),
          setup: { generation: replacement.generation, acknowledged: false },
        },
      },
    })
    await tx.mfaOperation.create({
      data: {
        id: operationId,
        flowId: flow.id,
        kind: 'rotate_backup_codes',
        result: { generation: replacement.generation },
      },
    })
    await this.events.backupCodesChanged(tx, flow, operationId, replacement.generation, now)
    const finalNow = await mfaDatabaseClock(tx)
    assertFlowDeadline(locked, finalNow)
    if (session.expiresAt <= finalNow) throw new ExpiredDuringVerification()
    const finalRequired = requiredMfaProofs(evidence, factor.version, finalNow)
    if (finalRequired.length) throw new FreshnessChanged(finalRequired)
    return { outcome: 'codes', ...replacement }
  }
}
