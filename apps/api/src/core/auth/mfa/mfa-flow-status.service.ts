import { Injectable } from '@nestjs/common'

import { type MfaStatus } from '@amcore/shared'

import { AppException, ServiceUnavailableException } from '../../../common/exceptions/index.js'
import { PrismaService } from '../../../prisma/index.js'

import { accountRequiresMfa } from './mfa-account-policy.js'
import { type FlowRequest, lockMfaFlow } from './mfa-flow-lock.js'
import { resolveFlowProofs } from './mfa-flow-proofs.js'
import { flowProofWindowSeconds, freshOAuthFlowIdentity, readFlowProofs } from './mfa-flow-state.js'
import { requiredMfaProofs } from './mfa-policy.js'
import { readSeedDraft } from './mfa-seed-draft.js'
import { readSetupState } from './mfa-setup-state.js'
import { mfaDatabaseClock } from './mfa-transaction.js'

/** Own bound nonsecret status only. Never repeats a mutation or returns a seed/code set/credentials. */
@Injectable()
export class MfaFlowStatusService {
  constructor(private readonly prisma: PrismaService) {}

  async read(request: FlowRequest): Promise<MfaStatus> {
    return this.prisma.$transaction(
      async (tx) => {
        const locked = await lockMfaFlow(tx, request, { recoveryPending: true })
        if (!locked) throw new AppException('Continuation changed', 401, 'AUTH_CONTEXT_CHANGED')
        const { flow, source } = locked
        const account = await tx.mfaAccount.findUniqueOrThrow({ where: { userId: flow.userId } })
        const user = await tx.user.findUniqueOrThrow({
          where: { id: flow.userId },
          select: { systemRole: true },
        })
        const factor = await tx.mfaFactor.findUnique({
          where: { userId: flow.userId },
          select: { version: true },
        })
        const protectedAccount = accountRequiresMfa({
          ...account,
          systemRole: user.systemRole,
          factorVersion: factor?.version ?? null,
        })
        if (protectedAccount) {
          const protocol = await tx.mfaProtocol.findUnique({ where: { id: 'platform' } })
          if (protocol?.state !== 'active' || protocol.version !== 1)
            throw new ServiceUnavailableException('MFA unavailable')
        }
        const evidence = resolveFlowProofs(readFlowProofs(flow.data), {
          flowId: flow.id,
          sourceFamilyId: flow.sourceFamilyId,
          source,
          codeGeneration: account.codeGeneration,
        })
        const remainingCodes = await tx.mfaRecoveryCode.count({
          where: { userId: flow.userId, generation: account.codeGeneration, consumedAt: null },
        })
        const now = await mfaDatabaseClock(tx)
        if (
          flow.expiresAt <= now ||
          (source && source.expiresAt <= now) ||
          (locked.context && locked.context.expiresAt <= now)
        )
          throw new AppException('Continuation expired', 401, 'AUTH_CONTEXT_CHANGED')
        const requiredProofs = requiredMfaProofs(
          evidence,
          factor?.version ?? 0,
          now,
          flowProofWindowSeconds(flow)
        ).filter(
          (kind) =>
            protectedAccount ||
            (kind === 'password' &&
              !freshOAuthFlowIdentity(flow.data, account.securityVersion, now))
        )
        const setup = readSetupState(flow.data)
        const state = requiredProofs.includes('password')
          ? 'password_required'
          : (setup && !setup.acknowledged) ||
              (flow.purpose === 'initial_setup' && factor && !account.setupComplete)
            ? 'codes_pending'
            : !factor && protectedAccount
              ? 'enrollment_required'
              : requiredProofs.length
                ? 'verify_required'
                : flow.purpose === 'rotate_codes' && setup?.acknowledged
                  ? 'completed'
                  : flow.purpose === 'replace_factor' && readSeedDraft(flow.data)
                    ? 'enrollment_required'
                    : 'ready'
        return {
          kind: 'mfa',
          purpose: request.purpose,
          state,
          expiresAt: flow.expiresAt.toISOString(),
          requiredProofs,
          remainingCodes,
          generation: account.codeGeneration,
        }
      },
      { maxWait: 2000, timeout: 4000 }
    )
  }
}
