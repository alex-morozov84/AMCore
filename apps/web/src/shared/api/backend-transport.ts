import { AMCORE_CLIENT_IP_HEADER } from '@amcore/shared'

import { isSpoofableForwardingHeader } from './bff/proxy-headers'
import { resolveTrustedClientIp } from './bff/trusted-client-ip'

import 'server-only'

export type BackendRequestInit = Omit<RequestInit, 'redirect'> & {
  redirect?: 'error' | 'manual'
  duplex?: 'half'
}

export function getBackendBaseUrl(): string {
  return process.env.API_URL ?? 'http://localhost:5002'
}

function backendTarget(target: string | URL): URL {
  const base = new URL(getBackendBaseUrl())
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password)
    throw new TypeError('Invalid backend configuration')
  if (!(typeof target === 'string' || target instanceof URL))
    throw new TypeError('Backend target must be a string or URL')
  const raw = String(target)
  if (
    raw.includes('\\') ||
    raw.trim() !== raw ||
    raw.startsWith('//') ||
    !(raw.startsWith('/') || /^https?:\/\//i.test(raw))
  )
    throw new TypeError('Invalid backend target')
  const url = new URL(raw, base)
  if (url.origin !== base.origin || url.username || url.password)
    throw new TypeError('Backend target must use the configured API origin')
  return url
}

/** Send only caller-selected headers; derive the visitor claim from the original request. */
export function fetchBackendResponse(
  target: string | URL,
  source: Headers,
  init: BackendRequestInit = {}
): Promise<Response> {
  const url = backendTarget(target)
  if (!(source instanceof Headers)) throw new TypeError('Original request headers are required')
  const redirect = init.redirect ?? 'error'
  if (redirect !== 'error' && redirect !== 'manual')
    throw new TypeError('Backend redirect following is forbidden')
  const headers = new Headers(init.headers)
  for (const name of [...headers.keys()])
    if (isSpoofableForwardingHeader(name.toLowerCase())) headers.delete(name)
  const visitorIp = resolveTrustedClientIp(source)
  if (visitorIp) headers.set(AMCORE_CLIENT_IP_HEADER, visitorIp)
  return fetch(typeof target === 'string' ? url.toString() : url, { ...init, headers, redirect })
}
