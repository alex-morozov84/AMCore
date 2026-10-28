import { NextResponse } from 'next/server'
import {
  type MfaBrowserCommand,
  type MfaBrowserView,
  mfaCodesAcknowledgementResultSchema,
  mfaEnrollmentResultSchema,
  mfaFactorBindingResultSchema,
  mfaRecoveryTicketResultSchema,
  mfaSetupCodesResultSchema,
  mfaStatusSchema,
} from '@amcore/shared'

import { apiErrorResponse } from './api-error-response'
import {
  type BrowserAuthFlow,
  retainSetupSuccessor,
  updateBrowserAuthAttempt,
} from './browser-auth-attempt'
import { postBrowserAuth } from './browser-auth-upstream'
import { changedBrowserContext, unavailableBrowserContext } from './browser-binding.server'
import { ContextRequestError } from './context-errors'
import type { ProductWebContext } from './product-web-context.server'

import 'server-only'

type Inspect = (record: BrowserAuthFlow, terminal?: 'attempts_exhausted') => Promise<MfaBrowserView>
/** Setup secrets cross only this one mutation response; they never enter Redis or ordinary user state. */
export async function commandSetupMfa(
  request: Request,
  context: ProductWebContext,
  handle: string,
  record: BrowserAuthFlow,
  command: MfaBrowserCommand,
  inspect: Inspect
): Promise<NextResponse> {
  if (!['initial_setup', 'replace_factor'].includes(record.flow.purpose))
    throw changedBrowserContext()
  const base = { purpose: record.flow.purpose, operationId: command.operationId }
  if (command.action === 'redeem_recovery_ticket') {
    if (!command.password || !command.ticket || command.proof || command.generation)
      throw new ContextRequestError(400, 'BAD_REQUEST')
    const upstream = await postBrowserAuth(
      request,
      context,
      record,
      '/auth/mfa/redeem-recovery-ticket',
      { ...base, password: command.password, ticket: command.ticket },
      record.flow.continuation
    )
    const result = mfaRecoveryTicketResultSchema.parse(upstream.body)
    if (['wrong_password', 'wrong_ticket'].includes(result.outcome))
      return apiErrorResponse(request, {
        statusCode: 422,
        errorCode: 'MFA_RECOVERY_TICKET_INVALID',
        message: 'Recovery proof not accepted',
      })
    if (result.outcome !== 'enrollment') return rejected(request, record, result, inspect)
    const retained = await retainSetupSuccessor(handle, record, result.successor, context)
    return NextResponse.json({ view: await inspect(retained) })
  }

  if (command.action === 'start_enrollment') {
    if (command.password || command.proof || command.generation)
      throw new ContextRequestError(400, 'BAD_REQUEST')
    const upstream = await postBrowserAuth(
      request,
      context,
      record,
      '/auth/mfa/enrollment',
      { ...base, regenerate: false },
      record.flow.continuation
    )
    const result = mfaEnrollmentResultSchema.parse(upstream.body)
    if (result.outcome === 'seed')
      return NextResponse.json({ view: await inspect(record), enrollment: result.enrollment })
    return rejected(request, record, result, inspect)
  }
  if (command.action === 'acknowledge_codes') {
    if (!command.generation || command.password || command.proof)
      throw new ContextRequestError(400, 'BAD_REQUEST')
    const upstream = await postBrowserAuth(
      request,
      context,
      record,
      '/auth/mfa/acknowledge-codes',
      { ...base, generation: command.generation },
      record.flow.continuation
    )
    const result = mfaCodesAcknowledgementResultSchema.parse(upstream.body)
    if (result.outcome === 'acknowledged') return NextResponse.json({ view: await inspect(record) })
    return rejected(request, record, result, inspect)
  }
  if (!command.proof || command.password || command.generation)
    throw new ContextRequestError(400, 'BAD_REQUEST')
  if (command.action === 'recover_codes') {
    const upstream = await postBrowserAuth(
      request,
      context,
      record,
      '/auth/mfa/recover-setup-codes',
      { ...base, proof: command.proof },
      record.flow.continuation
    )
    const result = mfaSetupCodesResultSchema.parse(upstream.body)
    if (result.outcome === 'codes') {
      const view = await inspect(record)
      if (view.kind !== 'flow') throw changedBrowserContext()
      const status = mfaStatusSchema.parse({ ...view, kind: 'mfa' })
      await updateBrowserAuthAttempt(
        handle,
        record,
        {
          ...record,
          flow: { ...record.flow, ...status },
          expiresAt: Math.min(record.expiresAt, Date.parse(status.expiresAt)),
        },
        context
      )
      return NextResponse.json({ view, backupCodes: result.backupCodes })
    }
    return rejected(request, record, result, inspect)
  }
  if (command.action !== 'verify') throw new ContextRequestError(400, 'BAD_REQUEST')
  const upstream = await postBrowserAuth(
    request,
    context,
    record,
    '/auth/mfa/bind-factor',
    { ...base, proof: command.proof },
    record.flow.continuation
  )
  const result = mfaFactorBindingResultSchema.parse(upstream.body)
  if (result.outcome !== 'bound') return rejected(request, record, result, inspect)
  const retained = await retainSetupSuccessor(handle, record, result.successor, context)
  return NextResponse.json({
    view: await inspect(retained),
    backupCodes: result.successor.backupCodes,
  })
}

type Outcome = { outcome: string; retryAfter?: number }
async function rejected(
  request: Request,
  record: BrowserAuthFlow,
  result: Outcome,
  inspect: Inspect
): Promise<NextResponse> {
  if (result.outcome === 'attempts_exhausted')
    return NextResponse.json({ view: await inspect(record, 'attempts_exhausted') })
  if (result.outcome === 'wrong_code')
    return apiErrorResponse(request, {
      statusCode: 422,
      errorCode: 'MFA_INVALID_PROOF',
      message: 'Code not accepted',
    })
  if (result.outcome === 'limited') {
    const response = apiErrorResponse(request, {
      statusCode: 429,
      errorCode: 'RATE_LIMIT_EXCEEDED',
      message: 'MFA attempt limit reached',
    })
    if (result.retryAfter) response.headers.set('retry-after', String(result.retryAfter))
    return response
  }
  if (result.outcome === 'unavailable') throw unavailableBrowserContext()
  if (['restart_required', 'generation_changed', 'already_bound'].includes(result.outcome))
    throw changedBrowserContext()
  if (result.outcome === 'draft_exists') throw new ContextRequestError(409, 'AUTH_CONTEXT_CHANGED')
  return NextResponse.json({ view: await inspect(record) })
}
