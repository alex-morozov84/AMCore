import { randomUUID } from 'node:crypto'

import type { MfaRecoveryTicket, Prisma } from '../../../generated/prisma/client.js'

import { reserveBrowserLogin } from './browser-login-reservation.js'
import {
  continuationHash,
  directFlowBinding,
  type FlowRequest,
  type LockedMfaFlow,
} from './mfa-flow-lock.js'
import { flowData } from './mfa-flow-state.js'
import { storedInvitationIntentSchema } from './mfa-invitation-intent.js'
import { mfaCredential } from './mfa-secrets.js'

/** One winning response gets the successor credential. A parent retry cannot reconstruct it. */
export async function writeRecoveryEnrollment(
  tx: Prisma.TransactionClient,
  locked: LockedMfaFlow,
  request: FlowRequest,
  ticket: MfaRecoveryTicket,
  operationId: string,
  verifiedAt: Date,
  now: Date
): Promise<{ request: FlowRequest; expiresAt: Date } | null> {
  const { flow } = locked
  const previousInvitation = flowData(flow.data).invitation
  const invitation =
    previousInvitation === undefined || previousInvitation === null
      ? null
      : storedInvitationIntentSchema.parse(previousInvitation)
  const flowId = randomUUID()
  const credential = mfaCredential()
  const expiresAt = new Date(Math.min(flow.expiresAt.getTime(), ticket.expiresAt.getTime()))
  const consumed = await tx.mfaRecoveryTicket.updateMany({
    where: {
      id: ticket.id,
      userId: flow.userId,
      securityVersion: flow.securityVersion,
      credentialHash: ticket.credentialHash,
      consumedAt: null,
      expiresAt: { gt: now },
    },
    data: { consumedAt: now, consumedByFlowId: flowId },
  })
  if (consumed.count !== 1) return null
  const context = locked.context
    ? await reserveBrowserLogin(
        tx,
        {
          context: locked.context,
          targetUserId: flow.userId,
          accountIds: [flow.userId],
        },
        request.browser!,
        flowId,
        expiresAt
      )
    : null
  if (locked.context && !context) throw new Error('Recovery browser reservation changed')
  const bindingHash = context ? request.bindingHash : directFlowBinding(credential)!
  await tx.mfaFlow.create({
    data: {
      id: flowId,
      credentialHash: continuationHash(credential)!,
      userId: flow.userId,
      purpose: 'initial_setup',
      authorityKind: 'recovery_setup',
      audience: flow.audience,
      bindingHash,
      securityVersion: flow.securityVersion,
      expiresAt,
      browserContextId: context?.id ?? null,
      publicationGeneration: context?.generation ?? null,
      primaryAt: verifiedAt,
      data: {
        ...(invitation ? { invitation } : {}),
        proofs: {
          primary: {
            method: 'password',
            eventId: randomUUID(),
            verifiedAt: verifiedAt.toISOString(),
            origin: { kind: 'flow', flowId },
          },
          secondFactor: null,
        },
      },
    },
  })
  await tx.mfaFlow.update({ where: { id: flow.id }, data: { state: 'retired' } })
  await tx.mfaOperation.create({
    data: {
      id: operationId,
      flowId: flow.id,
      kind: 'redeem_recovery_ticket',
      result: { outcome: 'consumed', successorFlowId: flowId },
    },
  })
  return {
    expiresAt,
    request: {
      credential,
      purpose: 'initial_setup',
      audience: flow.audience,
      bindingHash,
      browser: context ? { ...request.browser!, generation: context.generation } : null,
    },
  }
}
