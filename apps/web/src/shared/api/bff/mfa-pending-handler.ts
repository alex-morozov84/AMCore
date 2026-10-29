import { NextResponse } from 'next/server'
import {
  mfaBrowserCommandSchema,
  type MfaBrowserView,
  mfaPasswordResultSchema,
  mfaStatusSchema,
  mfaVerificationResultSchema,
  publicationStatusSchema,
} from '@amcore/shared'

import { apiErrorResponse } from './api-error-response'
import {
  markBrowserAuthCancelled,
  readBrowserAuthAttempt,
  updateBrowserAuthAttempt,
} from './browser-auth-attempt'
import { postBrowserAuth } from './browser-auth-upstream'
import {
  changedBrowserContext,
  createBrowserBindingVerifier,
  unavailableBrowserContext,
} from './browser-binding.server'
import { completeBrowserLogin } from './browser-login-handler'
import { confirmedConsoleReturn } from './console-return-destination'
import { readContextJson } from './context-body-budget'
import { ContextRequestError } from './context-errors'
import { resumeInvitedBrowserPublication } from './invited-browser-login'
import { currentFlowView, flowView, stagedEntry } from './mfa-flow-view'
import { reconcileBrowserLogin } from './mfa-reconcile-login'
import { commandMfaRotation } from './mfa-rotation-command'
import { settingsSource, startMfaSettings } from './mfa-settings-handler'
import { commandSetupMfa } from './mfa-setup-command'
import type { ProductWebContext } from './product-web-context.server'

import 'server-only'

export async function inspectPendingMfa(
  request: Request,
  context: ProductWebContext
): Promise<NextResponse> {
  const query = new URL(request.url).searchParams
  if (
    [...query.keys()].some((key) => key !== 'operationId') ||
    query.getAll('operationId').length > 1 ||
    (query.has('operationId') && !/^[a-f0-9-]{36}$/i.test(query.get('operationId')!))
  )
    throw new ContextRequestError(400, 'BAD_REQUEST')
  const attempt = await readBrowserAuthAttempt(request.headers, context)
  if (!attempt || !('flow' in attempt.record)) return NextResponse.json({ kind: 'unavailable' })
  const record = attempt.record
  if (record.cancelled) return NextResponse.json(flowView(record, 'cancelled'))
  if (
    record.sourceFingerprint &&
    (await settingsSource(request, context)).sourceFingerprint !== record.sourceFingerprint
  )
    throw changedBrowserContext()
  const expected = request.headers.get('x-amcore-mfa-flow')
  if (expected && expected !== record.id) throw changedBrowserContext()
  if (
    record.state !== 'flow' &&
    query.has('operationId') &&
    query.get('operationId') !== record.completionId &&
    query.get('operationId') !== record.publicationCommandId
  )
    throw changedBrowserContext()
  if (record.state === 'flow') {
    const view = await currentFlowView(request, context, record)
    if (
      view.kind === 'flow' &&
      view.purpose === 'rotate_codes' &&
      view.state === 'completed' &&
      record.flow.state !== 'completed'
    )
      await updateBrowserAuthAttempt(
        attempt.handle,
        record,
        {
          ...record,
          flow: { ...record.flow, ...mfaStatusSchema.parse({ ...view, kind: 'mfa' }) },
        },
        context
      )
    return NextResponse.json(view)
  }
  const upstream = await postBrowserAuth(
    request,
    context,
    record,
    '/auth/mfa/publication/status',
    { purpose: record.flow.purpose, operationId: record.completionId },
    record.flow.continuation
  )
  const result = publicationStatusSchema.safeParse(upstream.body)
  if (upstream.status !== 200 || !result.success) throw unavailableBrowserContext()
  if (result.data.state !== 'published')
    return NextResponse.json(
      flowView(
        record,
        record.state === 'staged' && result.data.state === 'pending' ? 'ready' : 'restart_required'
      )
    )
  if (!('vaultId' in record) || result.data.familyId !== record.familyId)
    throw changedBrowserContext()
  const entry = await stagedEntry(context, record)
  await createBrowserBindingVerifier(request.headers, context.audience)(entry)
  const consoleReturn = await confirmedConsoleReturn(request, context, record, entry)
  const response = NextResponse.json({
    ...flowView(record, 'completed'),
    publication: 'confirmed',
    ...(consoleReturn ? { consoleReturn } : {}),
  })
  if (record.invitation) {
    const settled = await resumeInvitedBrowserPublication(
      request,
      context,
      attempt.handle,
      record,
      true
    )
    for (const cookie of settled.cookies.getAll()) response.cookies.set(cookie)
  } else response.cookies.set(context.cookieName, record.vaultId, context.cookieOptions)
  return response
}

export async function commandPendingMfa(
  request: Request,
  context: ProductWebContext
): Promise<NextResponse> {
  if (
    new URL(request.url).search ||
    !/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')
  )
    throw new ContextRequestError(400, 'BAD_REQUEST')
  const command = mfaBrowserCommandSchema.safeParse(await readContextJson(request.body, 2048))
  if (!command.success) throw new ContextRequestError(400, 'BAD_REQUEST')
  if (['start_code_rotation', 'start_replacement'].includes(command.data.action))
    return startMfaSettings(request, context, command.data)
  const attempt = await readBrowserAuthAttempt(request.headers, context)
  if (!attempt || !('flow' in attempt.record)) throw changedBrowserContext()
  const { handle, record } = attempt
  if (
    record.sourceFingerprint &&
    (await settingsSource(request, context)).sourceFingerprint !== record.sourceFingerprint
  )
    throw changedBrowserContext()
  if (command.data.flowBinding !== record.id) throw changedBrowserContext()
  if (
    record.state === 'flow' &&
    record.flow.purpose === 'rotate_codes' &&
    ['rotate_codes', 'recover_codes', 'acknowledge_codes'].includes(command.data.action)
  )
    return commandMfaRotation(request, context, handle, record, command.data, () =>
      currentFlowView(request, context, record)
    )
  if (record.state === 'flow' && command.data.action === 'start_recovery') {
    if (
      command.data.password ||
      command.data.proof ||
      command.data.ticket ||
      command.data.generation
    )
      throw new ContextRequestError(400, 'BAD_REQUEST')
    return NextResponse.json({
      view: { kind: 'recovery_ticket', accountLabel: record.accountLabel, flowBinding: record.id },
    })
  }
  if (record.state === 'flow') {
    const setupAction = [
      'start_enrollment',
      'acknowledge_codes',
      'recover_codes',
      'redeem_recovery_ticket',
    ].includes(command.data.action)
    const current =
      command.data.action === 'verify' ? await currentFlowView(request, context, record) : undefined
    const seedProof = current?.kind === 'flow' && current.state === 'enrollment_required'
    if (setupAction || seedProof) {
      const response = await commandSetupMfa(
        request,
        context,
        handle,
        record,
        command.data,
        (current, terminal) =>
          terminal
            ? Promise.resolve(flowView(current, terminal))
            : currentFlowView(request, context, current)
      )
      if (command.data.action !== 'acknowledge_codes' || !response.ok) return response
      const result = (await response.clone().json()) as { view?: MfaBrowserView }
      if (
        result.view?.kind !== 'flow' ||
        result.view.state !== 'ready' ||
        result.view.purpose !== 'initial_setup'
      )
        return response
      const completed = await completeBrowserLogin(
        request,
        context,
        handle,
        record,
        record.completionId,
        command.data.operationId
      )
      const retained = await readBrowserAuthAttempt(request.headers, context)
      if (!retained) throw changedBrowserContext()
      const final = await reconcileBrowserLogin(request, context, retained.handle, retained.record)
      for (const cookie of completed.cookies.getAll()) final.cookies.set(cookie)
      return final
    }
  }
  if (command.data.action === 'cancel') {
    const cancelled = await postBrowserAuth(request, context, record, '/auth/logout', {})
    if (cancelled.status !== 204) throw unavailableBrowserContext()
    await markBrowserAuthCancelled(handle, record, context)
    if ('vaultId' in record) await context.store.delete(record.vaultId).catch(() => undefined)
    const response = NextResponse.json({ view: flowView(record, 'cancelled') })
    // Exact server retirement is sufficient; a delayed response clears no newer cookie.
    return response
  }
  if (['verify', 'confirm_password'].includes(command.data.action) && record.state === 'flow') {
    const primary = command.data.action === 'confirm_password'
    if (
      primary
        ? !command.data.password || !!command.data.proof
        : !command.data.proof || !!command.data.password
    )
      throw new ContextRequestError(400, 'BAD_REQUEST')
    const result = await postBrowserAuth(
      request,
      context,
      record,
      primary ? '/auth/mfa/password' : '/auth/mfa/verify',
      {
        purpose: record.flow.purpose,
        operationId: command.data.operationId,
        ...(primary ? { password: command.data.password } : { proof: command.data.proof }),
      },
      record.flow.continuation
    )
    const verification = (
      primary ? mfaPasswordResultSchema : mfaVerificationResultSchema
    ).safeParse(result.body)
    if (!verification.success) throw unavailableBrowserContext()
    const value = verification.data
    if (value.outcome === 'password_setup_required')
      return NextResponse.json({
        view: {
          kind: 'password_setup_required',
          accountLabel: record.accountLabel,
          flowBinding: record.id,
        },
      })
    if (value.outcome === 'wrong_password')
      return apiErrorResponse(request, {
        statusCode: 422,
        errorCode: 'INVALID_CREDENTIALS',
        message: 'Password not accepted',
      })
    if (value.outcome === 'wrong_code')
      return apiErrorResponse(request, {
        statusCode: 422,
        errorCode: 'MFA_INVALID_PROOF',
        message: 'Code not accepted',
      })
    if (value.outcome === 'limited') {
      const response = apiErrorResponse(request, {
        statusCode: 429,
        errorCode: 'RATE_LIMIT_EXCEEDED',
        message: 'MFA attempt limit reached',
      })
      if ('retryAfter' in value && value.retryAfter)
        response.headers.set('retry-after', String(value.retryAfter))
      return response
    }
    if (value.outcome === 'unavailable') throw unavailableBrowserContext()
    if (value.outcome === 'restart_required') throw changedBrowserContext()
    const view =
      value.outcome === 'attempts_exhausted'
        ? flowView(record, 'attempts_exhausted')
        : await currentFlowView(request, context, record)
    if (view.kind === 'flow' && value.outcome !== 'attempts_exhausted') {
      const status = mfaStatusSchema.parse({ ...view, kind: 'mfa' })
      await updateBrowserAuthAttempt(
        handle,
        record,
        {
          ...record,
          flow: {
            ...record.flow,
            ...status,
            nextAction: view.state === 'ready' ? 'complete' : record.flow.nextAction,
          },
          expiresAt: Math.min(record.expiresAt, Date.parse(status.expiresAt)),
        },
        context
      )
    }
    return NextResponse.json({ view })
  }
  if (['complete_login', 'settle_login', 'reconcile_login'].includes(command.data.action)) {
    return reconcileBrowserLogin(request, context, handle, record)
  }
  throw new ContextRequestError(503, 'SERVICE_UNAVAILABLE')
}
