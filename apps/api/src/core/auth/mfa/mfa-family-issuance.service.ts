import { Injectable } from '@nestjs/common'
import { z } from 'zod'

import { SystemRole } from '@amcore/shared'

import { PrismaService } from '../../../prisma/index.js'
import { lockInvitationAuthAttempt } from '../../invitations/invitation-auth-handoff.js'
import { TokenService } from '../token.service.js'

import { accountRequiresMfa } from './mfa-account-policy.js'
import { type IssuedFamilyCredentials, writeFamily } from './mfa-family-writer.js'
import { continuationHash, type FlowRequest, lockMfaFlow } from './mfa-flow-lock.js'
import { resolveFlowProofs } from './mfa-flow-proofs.js'
import {
  flowData,
  freshOAuthFlowIdentity,
  oauthFlowIdentitySchema,
  readFlowProofs,
} from './mfa-flow-state.js'
import { storedInvitationIntentSchema, validateInvitationIntent } from './mfa-invitation-intent.js'
import { requiredMfaProofs } from './mfa-policy.js'
import { publicationSecretHash } from './mfa-publication-record.js'
import { type PublicationStatus, publicationStatus } from './mfa-publication-recovery.js'
import { mfaDatabaseClock } from './mfa-transaction.js'

const verifiedOperation = z.object({ outcome: z.literal('verified') }).strict()
type RequiredProof = 'password' | 'second_factor'
export type FamilyIssuance =
  | IssuedFamilyCredentials
  | { kind: 'issued'; status: PublicationStatus }
  | { kind: 'proof_required'; requiredProofs: RequiredProof[] }
  | { kind: 'enrollment_required' | 'restart_required' | 'unavailable' }

class IssuanceExpired extends Error {}
class IssuanceProofChanged extends Error {
  constructor(readonly requiredProofs: RequiredProof[]) {
    super('Issuance proof changed')
  }
}
interface IssuanceMetadata {
  vaultBinding: string | null
  userAgent?: string
  ipAddress?: string
}

/** Finalizes previously committed flow-local proof. It does not verify/consume a factor or create membership. */
@Injectable()
export class MfaFamilyIssuanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService
  ) {}

  async complete(
    request: FlowRequest,
    operationId: string,
    metadata: IssuanceMetadata
  ): Promise<FamilyIssuance> {
    z.string().uuid().parse(operationId)
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const hash = continuationHash(request.credential)
          if (!hash) return { kind: 'restart_required' }
          const hint = await tx.mfaFlow.findUnique({ where: { credentialHash: hash } })
          if (hint && ['committed', 'completed', 'retired'].includes(hint.state)) {
            return { kind: 'issued', status: await publicationStatus(tx, request, operationId) }
          }
          const invitationHint = storedInvitationIntentSchema.safeParse(
            hint && flowData(hint.data).invitation
          )
          if (invitationHint.success)
            await lockInvitationAuthAttempt(tx, {
              attemptId: invitationHint.data.attemptId,
              cleanupKeyHash: invitationHint.data.cleanupKeyHash,
            })
          const locked = await lockMfaFlow(tx, request)
          if (
            !locked ||
            !['identity', 'setup_successor'].includes(locked.flow.authorityKind) ||
            locked.flow.sourceFamilyId !== null ||
            !['login', 'initial_setup'].includes(locked.flow.purpose)
          )
            return { kind: 'restart_required' }
          const { flow, context } = locked
          const storedData = flowData(flow.data)
          const parsedInvitation = storedInvitationIntentSchema.safeParse(storedData.invitation)
          const invitation = parsedInvitation.success ? parsedInvitation.data : undefined
          if (
            (Object.hasOwn(storedData, 'invitation') &&
              storedData.invitation !== null &&
              !invitation) ||
            (invitation &&
              (!context ||
                !invitationHint.success ||
                invitationHint.data.attemptId !== invitation.attemptId)) ||
            (flow.transferId !== null && flow.authorityKind !== 'setup_successor')
          )
            return { kind: 'restart_required' }
          const vaultHash = publicationSecretHash('vault', metadata.vaultBinding)
          if (context ? !vaultHash : metadata.vaultBinding !== null)
            return { kind: 'restart_required' }
          const account = await tx.mfaAccount.findUniqueOrThrow({ where: { userId: flow.userId } })
          const factor = await tx.mfaFactor.findUnique({
            where: { userId: flow.userId },
            select: { version: true },
          })
          const user = await tx.user.findUniqueOrThrow({
            where: { id: flow.userId },
            select: { id: true, email: true, emailCanonical: true, systemRole: true },
          })
          if (request.browser?.audience === 'console' && user.systemRole !== SystemRole.SuperAdmin)
            return { kind: 'restart_required' }
          if (invitation) await validateInvitationIntent(tx, invitation, user.emailCanonical)
          const protectedAccount = accountRequiresMfa({
            ...account,
            systemRole: user.systemRole,
            factorVersion: factor?.version ?? null,
          })
          if (protectedAccount) {
            const protocol = await tx.mfaProtocol.findUnique({ where: { id: 'platform' } })
            if (protocol?.state !== 'active' || protocol.version !== 1)
              return { kind: 'unavailable' }
            if (!account.setupComplete || account.emergencyRequired || !factor)
              return { kind: 'enrollment_required' }
          }
          const proofs = readFlowProofs(flow.data)
          const evidence = resolveFlowProofs(proofs, {
            flowId: flow.id,
            sourceFamilyId: null,
            source: null,
            codeGeneration: account.codeGeneration,
          })
          const identity = oauthFlowIdentitySchema.safeParse(flowData(flow.data).identity)
          const now = await mfaDatabaseClock(tx)
          const hasOauthAt = (at: Date): boolean =>
            freshOAuthFlowIdentity(flow.data, account.securityVersion, at)
          const allRequired = requiredMfaProofs(evidence, factor?.version ?? 0, now)
          const required = allRequired.filter(
            (kind) => protectedAccount || (kind === 'password' && !hasOauthAt(now))
          )
          if (required.length) return { kind: 'proof_required', requiredProofs: required }
          const previous = await tx.mfaOperation.findUnique({ where: { id: operationId } })
          if (
            previous &&
            (previous.flowId !== flow.id ||
              !['verify_factor', 'verify_password'].includes(previous.kind) ||
              !verifiedOperation.safeParse(previous.result).success)
          )
            return { kind: 'restart_required' }
          if (flow.expiresAt <= now || (context && context.expiresAt <= now))
            throw new IssuanceExpired()
          const passwordFresh = !allRequired.includes('password')
          const primaryAt = passwordFresh
            ? evidence.primaryAt
            : identity.success
              ? new Date(identity.data.verifiedAt)
              : null
          const primaryProofId = passwordFresh
            ? evidence.primaryProofId
            : identity.success
              ? identity.data.eventId
              : null
          const primaryMethod = passwordFresh ? 'password' : 'oauth'
          const expiresAt = this.tokens.getRefreshTokenExpiration()
          if (expiresAt <= now) throw new IssuanceExpired()
          const deadline =
            context || protectedAccount
              ? new Date(
                  Math.min(
                    now.getTime() + 60_000,
                    invitation ? Date.parse(invitation.expiresAt) : Infinity
                  )
                )
              : null
          const credentials = await writeFamily(
            tx,
            {
              flow,
              ...(invitation ? { invitation } : {}),
              context,
              user,
              securityVersion: account.securityVersion,
              primaryMethod,
              primaryAt,
              primaryProofId,
              mfa: protectedAccount ? evidence : null,
              recoveryGeneration:
                protectedAccount && proofs.secondFactor?.method === 'recovery_code'
                  ? (proofs.secondFactor.recoveryGeneration ?? null)
                  : null,
              vaultHash,
              audience: request.browser?.audience ?? null,
              expiresAt,
              deadline,
              operationId,
              replaceOperation: !!previous,
              userAgent: metadata.userAgent,
              ipAddress: metadata.ipAddress,
            },
            this.tokens
          )
          const finalNow = await mfaDatabaseClock(tx)
          if (flow.expiresAt <= finalNow || (deadline && deadline <= finalNow))
            throw new IssuanceExpired()
          const finalRequired = requiredMfaProofs(evidence, factor?.version ?? 0, finalNow).filter(
            (kind) => protectedAccount || (kind === 'password' && !hasOauthAt(finalNow))
          )
          if (finalRequired.length) throw new IssuanceProofChanged(finalRequired)
          return credentials
        },
        { maxWait: 2000, timeout: 4000 }
      )
    } catch (error) {
      if (error instanceof IssuanceExpired) return { kind: 'restart_required' }
      if (error instanceof IssuanceProofChanged)
        return { kind: 'proof_required', requiredProofs: error.requiredProofs }
      throw error
    }
  }
}
