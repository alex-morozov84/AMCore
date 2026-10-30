import { randomBytes } from 'node:crypto'

import type { BrowserAudience } from '@amcore/shared'

import type { BrowserAuthContext, MfaFlow, Prisma, User } from '../../../generated/prisma/client.js'
import type { TokenService } from '../token.service.js'

import { issueFamilyAccessToken } from './mfa-access-issuance.js'
import type { StoredInvitationIntent } from './mfa-invitation-intent.js'
import type { MfaEvidence } from './mfa-policy.js'
import { type PublicationRecord, publicationSecretHash } from './mfa-publication-record.js'
import { mfaCredential } from './mfa-secrets.js'
import { mfaDatabaseClock } from './mfa-transaction.js'

export interface FamilyWritePlan {
  flow: MfaFlow
  invitation?: StoredInvitationIntent
  context: BrowserAuthContext | null
  user: Pick<User, 'id' | 'email' | 'systemRole'>
  securityVersion: number
  primaryMethod: 'password' | 'oauth'
  primaryAt: Date | null
  primaryProofId: string | null
  mfa: MfaEvidence | null
  recoveryGeneration: number | null
  vaultHash: string | null
  audience: BrowserAudience | null
  expiresAt: Date
  deadline: Date | null
  operationId: string
  replaceOperation: boolean
  userAgent?: string
  ipAddress?: string
}
export interface IssuedFamilyCredentials {
  kind: 'credentials'
  accessToken: string
  refreshToken: string
  receipt: string | null
  publication: PublicationRecord
}

/** Caller has checked current authority/proofs and holds ordered locks. No plaintext enters durable results. */
export async function writeFamily(
  tx: Prisma.TransactionClient,
  plan: FamilyWritePlan,
  tokens: TokenService
): Promise<IssuedFamilyCredentials> {
  const { flow, user, context, mfa } = plan
  const refreshToken = tokens.generateRefreshToken()
  const receipt = mfa ? mfaCredential() : null
  const pending = !!context || !!mfa
  if (!pending)
    await tx.user.update({
      where: { id: user.id },
      data: { lastLoginAt: await mfaDatabaseClock(tx) },
    })
  const family = await tx.authSessionFamily.create({
    data: {
      id: randomBytes(16).toString('hex'),
      userId: user.id,
      securityVersion: plan.securityVersion,
      primaryMethod: plan.primaryMethod,
      primaryAt: plan.primaryAt,
      primaryProofId: plan.primaryProofId,
      mfaAt: mfa?.mfaAt ?? null,
      mfaProofId: mfa?.mfaProofId ?? null,
      mfaMethod: mfa?.mfaMethod ?? null,
      factorVersion: mfa?.factorVersion ?? null,
      recoveryGeneration: plan.recoveryGeneration,
      publicationState: pending ? 'pending' : 'published',
      publicationDeadline: plan.deadline,
      receiptHash: publicationSecretHash('receipt', receipt),
      browserContextId: context?.id ?? null,
      publicationGeneration: context?.generation ?? null,
      expiresAt: plan.expiresAt,
    },
  })
  const session = await tx.session.create({
    data: {
      userId: user.id,
      familyId: family.id,
      refreshToken: tokens.hashRefreshToken(refreshToken),
      expiresAt: plan.expiresAt,
      lastAuthAt: plan.primaryAt,
      userAgent: plan.userAgent,
      ipAddress: plan.ipAddress,
    },
  })
  const intent = plan.invitation
  if (intent) {
    if (!context || !plan.deadline)
      throw new Error('Invitation publication requires browser authority')
    await tx.invitationAuthHandoff.create({
      data: {
        attemptId: intent.attemptId,
        cleanupKeyHash: intent.cleanupKeyHash,
        sessionId: session.id,
        actorId: user.id,
        deadline: plan.deadline,
      },
    })
  }
  const publication: PublicationRecord = {
    kind: 'issued_family',
    familyId: family.id,
    sessionId: session.id,
    securityVersion: plan.securityVersion,
    browser: context
      ? {
          contextId: context.id,
          generation: context.generation,
          audience: plan.audience!,
          stagedBindingHash: plan.vaultHash!,
        }
      : null,
    invitation: intent
      ? {
          attemptId: intent.attemptId,
          inviteId: intent.inviteId,
          organizationId: intent.organizationId,
          generation: intent.generation,
          recipient: intent.recipient,
        }
      : null,
    transferId: flow.transferId,
  }
  const data = { kind: 'issue_family', result: publication }
  if (plan.replaceOperation) await tx.mfaOperation.update({ where: { id: plan.operationId }, data })
  else await tx.mfaOperation.create({ data: { id: plan.operationId, flowId: flow.id, ...data } })
  await tx.mfaFlow.update({
    where: { id: flow.id },
    data: { state: pending ? 'committed' : 'completed' },
  })
  if (context)
    await tx.browserAuthContext.update({
      where: { id: context.id },
      data: {
        stagedBindingHash: plan.vaultHash,
        expiresAt: new Date(Math.max(context.expiresAt.getTime(), plan.expiresAt.getTime())),
      },
    })
  const accessToken = await issueFamilyAccessToken(tx, tokens, {
    sub: user.id,
    email: user.email,
    systemRole: user.systemRole,
    sid: session.id,
    fid: family.id,
    securityVersion: plan.securityVersion,
    ...(context && { browserBound: true as const }),
  })
  return { kind: 'credentials', accessToken, refreshToken, receipt, publication }
}
