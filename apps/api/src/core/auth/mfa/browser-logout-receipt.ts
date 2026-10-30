import type { BrowserLogoutReceiptLookup, BrowserLogoutReceiptResult } from '@amcore/shared'

import type { BrowserLogoutReceipt, Prisma } from '../../../generated/prisma/client.js'

import type { BrowserRequestBinding } from './browser-binding.js'
import { mfaHash } from './mfa-secrets.js'
import { settingsSourceChanged } from './mfa-settings-source.js'
import { mfaDatabaseClock } from './mfa-transaction.js'

export function logoutReceiptHash(secret: string): string {
  return mfaHash(JSON.stringify(['browser-logout-receipt-v1', secret]))
}
export function assertLogoutReceipt(
  record: BrowserLogoutReceipt,
  input: BrowserLogoutReceiptLookup,
  binding: BrowserRequestBinding
): void {
  if (
    record.returnEntryId !== input.returnEntryId ||
    record.credentialHash !== logoutReceiptHash(input.receiptSecret) ||
    record.contextId !== binding.contextId ||
    record.audience !== binding.audience ||
    record.bindingHash !== binding.bindingHash
  )
    throw settingsSourceChanged()
}

/** Historical outcome only. Its secret cannot authorize logout, reservation or a principal. */
export async function logoutReceiptView(
  tx: Prisma.TransactionClient,
  record: BrowserLogoutReceipt
): Promise<BrowserLogoutReceiptResult> {
  const context = await tx.browserAuthContext.findUnique({ where: { id: record.contextId } })
  const account = await tx.mfaAccount.findUnique({ where: { userId: record.userId } })
  const now = await mfaDatabaseClock(tx)
  let state: BrowserLogoutReceiptResult['state'] = 'superseded'
  if (record.expiresAt <= now) state = 'expired'
  else if (
    context &&
    context.expiresAt > now &&
    context.bindingHash === record.bindingHash &&
    context.audience === record.audience &&
    account?.securityVersion === record.securityVersion
  ) {
    if (
      context.generation === record.afterGeneration &&
      context.state === 'logged_out' &&
      !context.currentFamilyId &&
      !context.reservedFlowId
    )
      state = record.neutralAttemptId ? 'claimed' : 'logged_out'
    else if (record.reservedFlowId && context.generation === record.reservedGeneration) {
      if (context.state === 'reserved' && context.reservedFlowId === record.reservedFlowId)
        state = 'reserved'
      if (
        context.state === 'published' &&
        record.publishedFamilyId &&
        context.currentFamilyId === record.publishedFamilyId
      )
        state = 'published'
    }
  }
  return {
    state,
    operationId: record.operationId,
    returnEntryId: record.returnEntryId,
    contextId: record.contextId,
    audience: record.audience as 'product' | 'staff' | 'console',
    beforeGeneration: record.beforeGeneration,
    afterGeneration: record.afterGeneration,
    ...(record.neutralAttemptId ? { neutralAttemptId: record.neutralAttemptId } : {}),
    ...(record.reservedFlowId ? { flowId: record.reservedFlowId } : {}),
    ...(record.reservedGeneration !== null
      ? { reservedGeneration: record.reservedGeneration }
      : {}),
    ...(record.completionId ? { completionId: record.completionId } : {}),
    ...(record.publishedFamilyId ? { familyId: record.publishedFamilyId } : {}),
    expiresAt: record.expiresAt.toISOString(),
  }
}
