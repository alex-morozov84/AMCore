import { randomBytes } from 'node:crypto'

import type { RegistrationPublicationIntent } from '@amcore/shared'

import {
  type BrowserAuthFlow,
  type InvitedBrowserAttempt,
  readBrowserAuthAttempt,
  updateBrowserAuthAttempt,
} from './browser-auth-attempt'
import { changedBrowserContext } from './browser-binding.server'
import type { ProductWebContext } from './product-web-context.server'

import 'server-only'

/** Retain the proposed operation and secrets before the account-creation request can commit. */
export async function prepareBrowserRegistration(
  request: Request,
  context: ProductWebContext,
  invitation?: InvitedBrowserAttempt
) {
  const previous = await readBrowserAuthAttempt(request.headers, context)
  if (
    !previous ||
    previous.record.state !== 'ready' ||
    previous.record.invitation ||
    request.headers.get('x-amcore-login-attempt') !== previous.record.id
  )
    throw changedBrowserContext()
  const expiresAt = Math.min(previous.record.expiresAt, Date.now() + 300000)
  const intent: RegistrationPublicationIntent = {
    continuation: randomBytes(32).toString('base64url'),
    operationId: previous.record.id,
    vaultBinding: randomBytes(32).toString('base64url'),
  }
  const started = await updateBrowserAuthAttempt(
    previous.handle,
    previous.record,
    { ...previous.record, state: 'starting' },
    context
  )
  const proposed: BrowserAuthFlow = {
    ...previous.record,
    ...(invitation ? { invitation } : {}),
    state: 'flow',
    expiresAt,
    accountLabel: '',
    browser: { ...previous.record.browser, generation: previous.record.browser.generation + 1 },
    completionId: intent.operationId,
    vaultBinding: intent.vaultBinding,
    flow: {
      kind: 'mfa',
      purpose: 'login',
      state: 'ready',
      nextAction: 'complete',
      continuation: intent.continuation,
      expiresAt: new Date(expiresAt).toISOString(),
      requiredProofs: [],
      remainingCodes: 0,
      generation: 0,
      browser: { ...previous.record.browser, generation: previous.record.browser.generation + 1 },
    },
  }
  const flow = await updateBrowserAuthAttempt(previous.handle, started, proposed, context)
  if (flow.state !== 'flow') throw changedBrowserContext()
  const retained = await updateBrowserAuthAttempt(
    previous.handle,
    flow,
    { ...flow, state: 'issuing' },
    context
  )
  if (retained.state !== 'issuing') throw changedBrowserContext()
  return { handle: previous.handle, record: retained, previous: previous.record, intent }
}
