import type { BrowserContextView } from '@amcore/shared'

import { changedBrowserContext } from './browser-binding.server'
import { callLogoutReceipt, loadReturnEntry, saveReturnEntry } from './console-return-entry'
import type { ProductWebContext } from './product-web-context.server'

import 'server-only'

/** Claims only the actual result of this logout, never an observed generation increment. */
export async function claimConsoleReturn(
  request: Request,
  context: ProductWebContext,
  id: string,
  view: BrowserContextView
) {
  let record = await loadReturnEntry(request, context, id)
  if (!record || record.phase === 'superseded' || record.phase === 'prepared') return undefined
  const outcome = await callLogoutReceipt(request, context, record, 'logout-result')
  if (outcome.state === 'not_found') throw changedBrowserContext()
  if (
    !['logged_out', 'claimed'].includes(outcome.state) ||
    outcome.beforeGeneration !== record.browser.generation ||
    outcome.contextId !== view.contextId ||
    outcome.afterGeneration !== view.generation ||
    view.state !== 'logged_out' ||
    outcome.audience !== context.audience ||
    (outcome.neutralAttemptId && outcome.neutralAttemptId !== record.attemptId)
  ) {
    await saveReturnEntry(context, record, { phase: 'superseded', outcome })
    return undefined
  }
  const claimed = await callLogoutReceipt(
    request,
    context,
    record,
    'return-claim',
    { neutralAttemptId: record.attemptId },
    view.generation
  )
  if (claimed.state !== 'claimed' || claimed.neutralAttemptId !== record.attemptId)
    throw changedBrowserContext()
  record = await saveReturnEntry(context, record, { phase: 'claimed', outcome: claimed })
  return {
    record,
    proof: {
      operationId: record.operationId,
      returnEntryId: record.id,
      receiptSecret: record.receiptSecret,
      neutralAttemptId: record.attemptId,
    },
  }
}
