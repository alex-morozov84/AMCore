import { NextResponse } from 'next/server'
import { publicationStatusSchema } from '@amcore/shared'

import {
  type BrowserAuthAttempt,
  readBrowserAuthAttempt,
  updateBrowserAuthAttempt,
} from './browser-auth-attempt'
import { postBrowserAuth } from './browser-auth-upstream'
import { changedBrowserContext, createBrowserBindingVerifier } from './browser-binding.server'
import { completeBrowserLogin, publishBrowserLogin } from './browser-login-handler'
import { confirmedConsoleReturn } from './console-return-destination'
import { resumeInvitedBrowserPublication } from './invited-browser-login'
import { currentFlowView, flowView, stagedEntry } from './mfa-flow-view'
import type { ProductWebContext } from './product-web-context.server'

import 'server-only'

/** Reconcile one server-owned completion. Never reissue a credential from an issuing state. */
export async function reconcileBrowserLogin(
  request: Request,
  context: ProductWebContext,
  handle: string,
  initial: BrowserAuthAttempt
): Promise<NextResponse> {
  if (!('flow' in initial) || !['login', 'initial_setup'].includes(initial.flow.purpose))
    throw changedBrowserContext()
  let record = initial
  let settlement: NextResponse | undefined
  if (record.state === 'flow') {
    const view = await currentFlowView(request, context, record)
    if (view.kind === 'flow' && view.state === 'completed')
      return NextResponse.json({ view: flowView(record, 'restart_required') })
    if (view.kind !== 'flow' || view.state !== 'ready') return NextResponse.json({ view })
    settlement = await completeBrowserLogin(request, context, handle, record, record.completionId)
    const retained = await readBrowserAuthAttempt(request.headers, context)
    if (!retained || !('flow' in retained.record) || retained.record.id !== record.id)
      throw changedBrowserContext()
    record = retained.record
  }
  if (record.state === 'issuing' || record.state === 'cleanup_needed') {
    if (record.state === 'issuing') {
      // Fence the delayed worker before compensation; it cannot subsequently stage a vault.
      await updateBrowserAuthAttempt(
        handle,
        record,
        { ...record, state: 'cleanup_needed' },
        context
      )
    }
    await postBrowserAuth(
      request,
      context,
      record,
      '/auth/mfa/publication/retire',
      { purpose: record.flow.purpose, operationId: record.completionId },
      record.flow.continuation
    ).catch(() => undefined)
    return NextResponse.json({ view: flowView(record, 'restart_required') })
  }
  if (record.state !== 'staged' && record.state !== 'published') throw changedBrowserContext()
  const observed = await postBrowserAuth(
    request,
    context,
    record,
    '/auth/mfa/publication/status',
    { purpose: record.flow.purpose, operationId: record.completionId },
    record.flow.continuation
  )
  const status = publicationStatusSchema.parse(observed.body)
  if (status.state === 'pending' && record.state === 'staged') {
    settlement = await publishBrowserLogin(
      request,
      context,
      handle,
      record,
      await stagedEntry(context, record)
    )
  } else if (status.state !== 'published') {
    return NextResponse.json({ view: flowView(record, 'restart_required') })
  }
  if (status.familyId && status.familyId !== record.familyId) throw changedBrowserContext()
  if (status.state === 'published' && record.invitation)
    settlement = await resumeInvitedBrowserPublication(request, context, handle, record, true)
  const entry = await stagedEntry(context, record)
  await createBrowserBindingVerifier(request.headers, context.audience)(entry)
  const consoleReturn = await confirmedConsoleReturn(request, context, record, entry)
  const response = NextResponse.json({
    view: {
      ...flowView(record, 'completed'),
      publication: 'confirmed',
      ...(consoleReturn ? { consoleReturn } : {}),
    },
  })
  if (settlement) for (const cookie of settlement.cookies.getAll()) response.cookies.set(cookie)
  else response.cookies.set(context.cookieName, record.vaultId, context.cookieOptions)
  return response
}
