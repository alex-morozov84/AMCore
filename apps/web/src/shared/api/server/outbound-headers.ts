import { headers as nextHeaders } from 'next/headers'
import { AMCORE_CLIENT_IP_HEADER } from '@amcore/shared'

import { resolveTrustedClientIp } from '../bff/trusted-client-ip'

import { type BackendAuthMode, resolveAuthHeader } from './auth-header'

import 'server-only'

export type OutboundHeadersResult = { headers: Headers } | { authUnavailable: true }

/**
 * Never the inbound request's own headers verbatim - only the specific,
 * deliberate set this transport is allowed to add (correlation id, trusted
 * client IP when configured, and an auth header per `authMode`).
 */
export async function buildOutboundHeaders(
  correlationId: string,
  authMode: BackendAuthMode
): Promise<OutboundHeadersResult> {
  const inbound = await nextHeaders()
  const trustedIp = resolveTrustedClientIp(inbound)
  const authResult = await resolveAuthHeader(authMode)
  if ('unavailable' in authResult) return { authUnavailable: true }

  const outbound = new Headers({
    'Content-Type': 'application/json',
    'X-Correlation-Id': correlationId,
  })
  if (authResult.header) outbound.set('Authorization', authResult.header)
  if (trustedIp) outbound.set(AMCORE_CLIENT_IP_HEADER, trustedIp)
  return { headers: outbound }
}
