import { NextResponse } from 'next/server'
import {
  type MfaBrowserCommand,
  type MfaBrowserView,
  mfaCodesAcknowledgementResultSchema,
  mfaSetupCodesResultSchema,
  mfaStatusSchema,
} from '@amcore/shared'

import { type BrowserAuthFlow, updateBrowserAuthAttempt } from './browser-auth-attempt'
import { postBrowserAuth } from './browser-auth-upstream'
import { changedBrowserContext, unavailableBrowserContext } from './browser-binding.server'
import { ContextRequestError } from './context-errors'
import type { ProductWebContext } from './product-web-context.server'

import 'server-only'

/** Rotation keeps the original family. Unknown outcomes expose status, never the previous plaintext set. */
export async function commandMfaRotation(
  request: Request,
  context: ProductWebContext,
  handle: string,
  record: BrowserAuthFlow,
  command: MfaBrowserCommand,
  inspect: () => Promise<MfaBrowserView>
) {
  if (record.flow.purpose !== 'rotate_codes' || !record.sourceFingerprint)
    throw changedBrowserContext()
  if (command.password || command.proof || command.ticket)
    throw new ContextRequestError(400, 'BAD_REQUEST')
  const acknowledge = command.action === 'acknowledge_codes'
  if (acknowledge ? !command.generation : !!command.generation)
    throw new ContextRequestError(400, 'BAD_REQUEST')
  const result = await postBrowserAuth(
    request,
    context,
    record,
    acknowledge ? '/auth/mfa/acknowledge-codes' : '/auth/mfa/rotate-codes',
    {
      purpose: 'rotate_codes',
      operationId: command.operationId,
      ...(acknowledge ? { generation: command.generation } : {}),
    },
    record.flow.continuation
  )
  const value = (
    acknowledge ? mfaCodesAcknowledgementResultSchema : mfaSetupCodesResultSchema
  ).parse(result.body)
  if (value.outcome === 'unavailable') throw unavailableBrowserContext()
  if (['restart_required', 'generation_changed'].includes(value.outcome))
    throw changedBrowserContext()
  const view = await inspect()
  if (view.kind !== 'flow') throw changedBrowserContext()
  if (value.outcome === 'acknowledged')
    await updateBrowserAuthAttempt(
      handle,
      record,
      {
        ...record,
        flow: {
          ...record.flow,
          ...mfaStatusSchema.parse({ ...view, kind: 'mfa' }),
          state: 'completed',
        },
      },
      context
    )
  return NextResponse.json({
    view:
      value.outcome === 'acknowledged' ? { ...view, state: 'completed', requiredProofs: [] } : view,
    ...(value.outcome === 'codes' ? { backupCodes: value.backupCodes } : {}),
  })
}
