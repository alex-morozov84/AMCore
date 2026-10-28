import {
  AuthErrorCode,
  BROWSER_AUTH_HEADERS,
  CommonErrorCode,
  InfrastructureErrorCode,
  InviteErrorCode,
  type RegistrationPublicationIntent,
} from '@amcore/shared'

import { fetchBackendResponse, getBackendBaseUrl } from '../backend-transport'
import { parseRetryAfterSeconds } from '../retry-after'

import { type BrowserAuthAttempt } from './browser-auth-attempt'
import {
  changedBrowserContext,
  privateBrowserHeaders,
  readBrowserAnchor,
} from './browser-binding.server'
import { readContextJson } from './context-body-budget'
import { ContextRequestError } from './context-errors'
import type { ProductWebContext } from './product-web-context.server'
import { sessionMetadataHeaders } from './session-metadata-headers'
import { extractCookieValue } from './set-cookie'

import 'server-only'

type CredentialPath =
  | '/auth/mfa/rotate-codes'
  | '/auth/mfa/enrollment'
  | '/auth/mfa/bind-factor'
  | '/auth/mfa/acknowledge-codes'
  | '/auth/mfa/recover-setup-codes'
  | '/auth/mfa/redeem-recovery-ticket'
  | '/auth/register'
  | '/auth/invites/register'
  | '/auth/browser-publications/invitation-confirm'
  | '/auth/oauth/exchange'
  | '/auth/logout'
  | '/auth/mfa/status'
  | '/auth/mfa/verify'
  | '/auth/mfa/password'
  | '/auth/login'
  | '/auth/mfa/complete'
  | '/auth/mfa/publication/acknowledge'
  | '/auth/mfa/publication/status'
  | '/auth/mfa/publication/retire'

/** Never forward browser-provided transport headers. Only the selected record and actual cookie supply binding. */
export async function postBrowserAuth(
  request: Request,
  context: ProductWebContext,
  record: Pick<BrowserAuthAttempt, 'id' | 'browser'>,
  path: CredentialPath,
  body: unknown,
  continuation?: string,
  callbackBinding?: string,
  invitation?: { credential: string; attemptId: string; cleanupKey: string },
  registration?: RegistrationPublicationIntent
) {
  if (
    registration &&
    (!['/auth/register', '/auth/invites/register'].includes(path) ||
      (path === '/auth/register' && invitation) ||
      callbackBinding ||
      registration.operationId !== record.id ||
      continuation !== registration.continuation)
  )
    throw changedBrowserContext()
  if (invitation && !['/auth/login', '/auth/invites/register'].includes(path))
    throw changedBrowserContext()
  if (callbackBinding && (path !== '/auth/oauth/exchange' || continuation))
    throw changedBrowserContext()
  const anchor = readBrowserAnchor(request.headers, context.audience)
  if (!anchor) throw changedBrowserContext()
  const response = await fetchBackendResponse(
    `${getBackendBaseUrl()}/api/v1${path}`,
    request.headers,
    {
      method: 'POST',
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
      headers: {
        ...context.apiHeaders,
        ...sessionMetadataHeaders(request.headers),
        ...privateBrowserHeaders(context.audience),
        [BROWSER_AUTH_HEADERS.binding]: anchor,
        [BROWSER_AUTH_HEADERS.contextId]: record.browser.contextId,
        [BROWSER_AUTH_HEADERS.generation]: String(record.browser.generation),
        ...(path === '/auth/oauth/exchange'
          ? {
              'x-amcore-oauth-attempt': record.id,
              ...(callbackBinding ? { cookie: `refresh_token=${callbackBinding}` } : {}),
            }
          : {}),
        ...(invitation
          ? {
              'x-invitation-continuation': invitation.credential,
              'x-invitation-auth-attempt-id': invitation.attemptId,
              'x-invitation-handoff-key': invitation.cleanupKey,
            }
          : {}),
        ...(continuation ? { 'x-mfa-continuation': continuation } : {}),
        ...(registration
          ? {
              'x-mfa-vault-binding': registration.vaultBinding,
              'x-amcore-login-attempt': registration.operationId,
            }
          : {}),
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  )
  // An unreadable upstream reply is an unknown outcome, never a known client rejection.
  const result =
    response.status === 204
      ? null
      : await readContextJson(response.body, 16384).catch(() => {
          throw new ContextRequestError(503, 'SERVICE_UNAVAILABLE')
        })
  if (
    (response.status === 401 || response.status === 409) &&
    result &&
    typeof result === 'object' &&
    'errorCode' in result &&
    ['AUTH_CONTEXT_CHANGED', 'SESSION_CHANGED'].includes(String(result.errorCode))
  )
    throw changedBrowserContext()
  if (!response.ok) {
    const code =
      result && typeof result === 'object' && 'errorCode' in result ? result.errorCode : undefined
    const allowed: string[] = [
      ...Object.values(AuthErrorCode),
      ...Object.values(InviteErrorCode),
      ...Object.values(CommonErrorCode),
      ...Object.values(InfrastructureErrorCode),
    ]
    throw new ContextRequestError(
      response.status,
      typeof code === 'string' && allowed.includes(code) ? code : 'SERVICE_UNAVAILABLE',
      parseRetryAfterSeconds(response.headers)
    )
  }
  return {
    status: response.status,
    body: result,
    refreshToken: extractCookieValue(response, 'refresh_token'),
  }
}
