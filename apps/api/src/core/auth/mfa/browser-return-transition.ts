import { z } from 'zod'

import { type BrowserReturnProof, browserReturnProofSchema } from '@amcore/shared'

import { AppException } from '../../../common/exceptions/index.js'
import type { BrowserAuthContext, MfaFlow, Prisma } from '../../../generated/prisma/client.js'

import type { BrowserRequestBinding } from './browser-binding.js'
import { logoutReceiptHash } from './browser-logout-receipt.js'
import { mfaDatabaseClock } from './mfa-transaction.js'

const linkSchema = browserReturnProofSchema.omit({ receiptSecret: true })
export function parseBrowserReturnProof(raw: unknown): BrowserReturnProof | undefined {
  if (raw === undefined) return undefined
  try {
    return browserReturnProofSchema.parse(typeof raw === 'string' ? JSON.parse(raw) : raw)
  } catch {
    throw new AppException('Invalid return metadata', 400, 'VALIDATION_ERROR')
  }
}

/** Optional presentation join after independent credentials, never a reservation capability. */
export async function linkReturnReservation(
  tx: Prisma.TransactionClient,
  proof: BrowserReturnProof | undefined,
  before: BrowserRequestBinding,
  after: BrowserAuthContext,
  flowId: string,
  userId: string,
  securityVersion: number
): Promise<z.infer<typeof linkSchema> | undefined> {
  if (!proof) return undefined
  const record = await tx.browserLogoutReceipt.findUnique({
    where: { operationId: proof.operationId },
  })
  const now = await mfaDatabaseClock(tx)
  if (
    !record ||
    record.returnEntryId !== proof.returnEntryId ||
    record.credentialHash !== logoutReceiptHash(proof.receiptSecret) ||
    record.expiresAt <= now ||
    record.userId !== userId ||
    record.securityVersion !== securityVersion ||
    record.contextId !== before.contextId ||
    after.id !== before.contextId ||
    record.bindingHash !== before.bindingHash ||
    record.audience !== before.audience ||
    record.afterGeneration !== before.generation ||
    record.neutralAttemptId !== proof.neutralAttemptId ||
    record.reservedFlowId ||
    after.state !== 'reserved' ||
    after.reservedFlowId !== flowId
  )
    return undefined
  await tx.browserLogoutReceipt.update({
    where: { operationId: record.operationId },
    data: { reservedFlowId: flowId, reservedGeneration: after.generation },
  })
  return linkSchema.parse(proof)
}

/** This optional write shares the exact session publication transaction. */
export async function consumeReturnPublication(
  tx: Prisma.TransactionClient,
  flow: MfaFlow,
  completionId: string,
  familyId: string,
  generation: number | null
): Promise<void> {
  const data = z.object({ returnEntry: linkSchema.optional() }).passthrough().safeParse(flow.data)
  const link = data.success ? data.data.returnEntry : undefined
  if (!link) return
  const receipt = await tx.browserLogoutReceipt.findUnique({
    where: { operationId: link.operationId },
  })
  if (
    !receipt ||
    receipt.expiresAt <= (await mfaDatabaseClock(tx)) ||
    receipt.userId !== flow.userId ||
    receipt.securityVersion !== flow.securityVersion ||
    receipt.returnEntryId !== link.returnEntryId ||
    receipt.neutralAttemptId !== link.neutralAttemptId ||
    receipt.reservedFlowId !== flow.id ||
    receipt.reservedGeneration !== generation ||
    receipt.contextId !== flow.browserContextId ||
    receipt.audience !== flow.audience ||
    receipt.bindingHash !== flow.bindingHash
  )
    return
  await tx.browserLogoutReceipt.update({
    where: { operationId: receipt.operationId },
    data: { completionId, publishedFamilyId: familyId },
  })
}
