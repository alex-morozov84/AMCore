import { randomUUID } from 'node:crypto'

import type { Prisma } from '../../../generated/prisma/client.js'

import { reserveBrowserLogin } from './browser-login-reservation.js'
import {
  continuationHash,
  directFlowBinding,
  type FlowRequest,
  type LockedMfaFlow,
} from './mfa-flow-lock.js'
import { flowData } from './mfa-flow-state.js'
import { advanceAccountSecurity } from './mfa-invalidation.js'
import { storedInvitationIntentSchema } from './mfa-invitation-intent.js'
import type { MfaEvidence } from './mfa-policy.js'
import type { MfaProofRepository } from './mfa-proof.repository.js'
import { mfaCredential } from './mfa-secrets.js'
import type { SeedDraft } from './mfa-seed-draft.js'
import { type SetupTransfer, setupTransferSchema } from './mfa-setup-transfer.js'

export interface SetupSuccessor {
  request: FlowRequest
  flowId: string
  transferId: string
  codes: string[]
  generation: number
  expiresAt: Date
}

/** Caller has validated current authority, both required proofs and the NEW seed's unused TOTP. */
export async function writeSetupSuccessor(
  tx: Prisma.TransactionClient,
  request: FlowRequest,
  locked: LockedMfaFlow,
  evidence: MfaEvidence,
  draft: SeedDraft,
  operationId: string,
  acceptedStep: number,
  verifiedAt: Date,
  proofs: MfaProofRepository
): Promise<SetupSuccessor> {
  const { flow } = locked
  const previousInvitation = flowData(flow.data).invitation
  const invitation =
    previousInvitation === undefined || previousInvitation === null
      ? null
      : storedInvitationIntentSchema.parse(previousInvitation)
  const successorId = randomUUID()
  const credential = mfaCredential()
  const context = locked.context
    ? await reserveBrowserLogin(
        tx,
        { context: locked.context, targetUserId: flow.userId, accountIds: [flow.userId] },
        request.browser!,
        successorId,
        flow.expiresAt
      )
    : null
  if (locked.context && !context) throw new Error('Setup browser reservation changed')
  const account = await tx.mfaAccount.findUniqueOrThrow({ where: { userId: flow.userId } })
  const oldFactor = await tx.mfaFactor.findUnique({ where: { userId: flow.userId } })
  const factorVersion = (oldFactor?.version ?? 0) + 1
  const securityVersion = await advanceAccountSecurity(tx, flow.userId)
  const factorData = {
    id: draft.factorId,
    keyId: draft.keyId,
    encryptedSeed: draft.encryptedSeed,
    version: factorVersion,
    lastAcceptedStep: BigInt(acceptedStep),
  }
  await tx.mfaFactor.upsert({
    where: { userId: flow.userId },
    create: { ...factorData, userId: flow.userId },
    update: factorData,
  })
  await tx.mfaAccount.update({
    where: { userId: flow.userId },
    data: { required: true, setupComplete: false, emergencyRequired: false },
  })
  const backup = await proofs.replaceBackupCodesLocked(
    tx,
    flow.userId,
    securityVersion,
    account.codeGeneration
  )
  if (!backup) throw new Error('Setup backup generation changed')
  const primary = {
    eventId: evidence.primaryProofId!,
    verifiedAt: evidence.primaryAt!.toISOString(),
  }
  const secondFactor = { eventId: randomUUID(), verifiedAt: verifiedAt.toISOString() }
  const transfer: SetupTransfer = setupTransferSchema.parse({
    kind: 'setup_transfer',
    userId: flow.userId,
    predecessorFlowId: flow.id,
    predecessorFamilyId: flow.sourceFamilyId,
    successorFlowId: successorId,
    previousSecurityVersion: flow.securityVersion,
    securityVersion,
    factorId: draft.factorId,
    factorVersion,
    generation: backup.generation,
    expiresAt: flow.expiresAt.toISOString(),
    primary,
    secondFactor,
    previousMfaProofId: evidence.mfaProofId,
    browser: context
      ? {
          contextId: context.id,
          previousGeneration: request.browser!.generation,
          generation: context.generation,
          bindingHash: context.bindingHash,
          audience: request.browser!.audience,
        }
      : null,
  })
  const browser = context ? { ...request.browser!, generation: context.generation } : null
  const bindingHash = context?.bindingHash ?? directFlowBinding(credential)!
  await tx.mfaFlow.create({
    data: {
      id: successorId,
      userId: flow.userId,
      credentialHash: continuationHash(credential)!,
      purpose: 'initial_setup',
      authorityKind: 'setup_successor',
      securityVersion,
      transferId: operationId,
      audience: flow.audience,
      bindingHash,
      browserContextId: context?.id ?? null,
      publicationGeneration: context?.generation ?? null,
      expiresAt: flow.expiresAt,
      primaryAt: evidence.primaryAt,
      mfaAt: verifiedAt,
      mfaMethod: 'totp',
      factorVersion,
      data: {
        ...(invitation ? { invitation } : {}),
        proofs: {
          primary: {
            ...primary,
            method: 'password',
            origin: { kind: 'flow', flowId: successorId },
          },
          secondFactor: {
            ...secondFactor,
            method: 'totp',
            factorVersion,
            origin: { kind: 'flow', flowId: successorId },
          },
        },
        setup: { generation: backup.generation, acknowledged: false },
      },
    },
  })
  await tx.mfaOperation.create({
    data: { id: operationId, flowId: flow.id, kind: 'setup_transfer', result: transfer },
  })
  // The verified seed is now owned by the factor. Retiring its draft must never delete the factor.
  const { seedDraft: _draft, ...retained } = flow.data as Prisma.JsonObject
  await tx.mfaFlow.update({ where: { id: flow.id }, data: { state: 'retired', data: retained } })
  return {
    request: {
      credential,
      purpose: 'initial_setup',
      audience: flow.audience,
      bindingHash,
      browser,
    },
    flowId: successorId,
    transferId: operationId,
    codes: backup.codes,
    generation: backup.generation,
    expiresAt: flow.expiresAt,
  }
}
