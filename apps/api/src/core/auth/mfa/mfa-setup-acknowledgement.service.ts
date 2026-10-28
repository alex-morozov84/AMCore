import { Injectable } from '@nestjs/common'
import { z } from 'zod'

import { PrismaService } from '../../../prisma/index.js'

import { type FlowRequest, lockMfaFlow } from './mfa-flow-lock.js'
import { resolveFlowProofs } from './mfa-flow-proofs.js'
import {
  assertFlowDeadline,
  ExpiredDuringVerification,
  flowData,
  readFlowProofs,
} from './mfa-flow-state.js'
import { requiredMfaProofs } from './mfa-policy.js'
import { MfaSecurityEvents } from './mfa-security-events.service.js'
import { readSetupState } from './mfa-setup-state.js'
import { MfaSourceLimiterService } from './mfa-source-limiter.service.js'
import { mfaDatabaseClock } from './mfa-transaction.js'

type RequiredProof = 'password' | 'second_factor'
type Acknowledgement =
  | { outcome: 'acknowledged'; generation: number }
  | { outcome: 'proof_required'; requiredProofs: RequiredProof[] }
  | { outcome: 'restart_required' | 'generation_changed' | 'unavailable' }
class FreshnessChanged extends Error {
  constructor(readonly requiredProofs: RequiredProof[]) {
    super('Setup acknowledgement proof changed')
  }
}

/** A checkbox acknowledges exactly one generated set. It never issues credentials or recreates codes. */
@Injectable()
export class MfaSetupAcknowledgementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sourceLimiter: MfaSourceLimiterService,
    private readonly events: MfaSecurityEvents
  ) {}

  async acknowledge(
    request: FlowRequest,
    operationId: string,
    generation: number,
    source: string
  ): Promise<Acknowledgement> {
    z.string().uuid().parse(operationId)
    z.number().int().positive().parse(generation)
    await this.sourceLimiter.consume('verify', source)
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const locked = await lockMfaFlow(tx, request)
          if (
            !locked ||
            !(locked.flow.purpose === 'initial_setup'
              ? ['identity', 'setup_successor'].includes(locked.flow.authorityKind)
              : locked.flow.purpose === 'rotate_codes' &&
                locked.flow.authorityKind === 'session' &&
                !!locked.source)
          )
            return { outcome: 'restart_required' }
          const { flow } = locked
          const protocol = await tx.mfaProtocol.findUnique({ where: { id: 'platform' } })
          if (protocol?.state !== 'active' || protocol.version !== 1)
            return { outcome: 'unavailable' }
          const account = await tx.mfaAccount.findUniqueOrThrow({ where: { userId: flow.userId } })
          const factor = await tx.mfaFactor.findUnique({ where: { userId: flow.userId } })
          if (
            !factor ||
            account.emergencyRequired ||
            !account.required ||
            (flow.purpose === 'rotate_codes' && !account.setupComplete)
          )
            return { outcome: 'restart_required' }
          const setup = readSetupState(flow.data)
          if (!setup || setup.generation !== generation || account.codeGeneration !== generation)
            return { outcome: 'generation_changed' }
          const previous = await tx.mfaOperation.findUnique({ where: { id: operationId } })
          if (
            previous &&
            (previous.flowId !== flow.id ||
              previous.kind !== 'acknowledge_setup' ||
              (previous.result as { generation?: number }).generation !== generation)
          )
            return { outcome: 'restart_required' }
          const now = await mfaDatabaseClock(tx)
          assertFlowDeadline(locked, now)
          if (setup.acknowledged && account.setupComplete)
            return { outcome: 'acknowledged', generation }
          const evidence = resolveFlowProofs(readFlowProofs(flow.data), {
            flowId: flow.id,
            sourceFamilyId: flow.sourceFamilyId,
            source: locked.source,
            codeGeneration: generation,
          })
          const required = requiredMfaProofs(evidence, factor.version, now)
          if (required.length) return { outcome: 'proof_required', requiredProofs: required }
          await tx.mfaAccount.update({
            where: { userId: flow.userId },
            data: { setupComplete: true },
          })
          await tx.mfaFlow.update({
            where: { id: flow.id },
            data: { data: { ...flowData(flow.data), setup: { generation, acknowledged: true } } },
          })
          if (!previous)
            await tx.mfaOperation.create({
              data: {
                id: operationId,
                flowId: flow.id,
                kind: 'acknowledge_setup',
                result: { generation },
              },
            })
          await this.events.setupAcknowledged(tx, flow, operationId, generation)
          const finalNow = await mfaDatabaseClock(tx)
          assertFlowDeadline(locked, finalNow)
          const finalRequired = requiredMfaProofs(evidence, factor.version, finalNow)
          if (finalRequired.length) throw new FreshnessChanged(finalRequired)
          return { outcome: 'acknowledged', generation }
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
}
