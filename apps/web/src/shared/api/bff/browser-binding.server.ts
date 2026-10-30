import {
  BROWSER_AUTH_HEADERS,
  type BrowserAudience,
  browserAudienceSchema,
  browserBindingProbeResultSchema,
  browserRevisionSchema,
} from '@amcore/shared'
import { z } from 'zod'

import { fetchBackendResponse, getBackendBaseUrl } from '../backend-transport'
import { parseRetryAfterSeconds } from '../retry-after'

import { ContextRequestError } from './context-errors'
import { sessionCookieOptions } from './session-cookie'
import type { VaultRecord } from './session-vault.types'

import 'server-only'

export const browserVaultBindingSchema = browserRevisionSchema
  .extend({
    familyId: z.string().min(1).max(128),
    securityVersion: z.number().int().nonnegative(),
    audience: browserAudienceSchema,
  })
  .strict()
export type BrowserVaultBinding = z.infer<typeof browserVaultBindingSchema>

export function browserAnchorCookie(audience: BrowserAudience) {
  const policy = sessionCookieOptions()
  const options = {
    httpOnly: policy.httpOnly,
    secure: policy.secure,
    sameSite: policy.sameSite,
    path: policy.path,
  }
  return {
    name: audience === 'product' ? 'amcore_browser_context' : `__Host-amcore_${audience}_context`,
    options: { ...options, ...(audience === 'product' ? {} : { secure: true }) },
  }
}

/** Raw Cookie parsing refuses duplicate capabilities rather than choosing whichever arrived first. */
export function readBrowserAnchor(source: Headers, audience: BrowserAudience): string | null {
  return readBrowserCapability(source, browserAnchorCookie(audience).name)
}

export function readBrowserCapability(source: Headers, name: string): string | null {
  const values = (source.get('cookie') ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.slice(0, part.indexOf('=')) === name)
    .map((part) => part.slice(part.indexOf('=') + 1))
  if (!values.length) return null
  if (values.length !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(values[0]!)) throw changedBrowserContext()
  return values[0]!
}

/** Audience is selected by a literal server entry/host, never by a browser header or stored snapshot. */
export function privateBrowserHeaders(audience: BrowserAudience): Record<string, string> {
  const key = process.env.WEB_FRONTEND_CONTEXT_KEY
  if (!key || key.length < 32) throw unavailableBrowserContext()
  return { [BROWSER_AUTH_HEADERS.key]: key, [BROWSER_AUTH_HEADERS.audience]: audience }
}

export function browserSessionHeaders(
  source: Headers,
  expected: BrowserAudience,
  entry: Pick<VaultRecord, 'audience' | 'browser'>
): Record<string, string> {
  const binding = browserVaultBindingSchema.safeParse(entry.browser)
  const anchor = readBrowserAnchor(source, expected)
  if (
    !anchor ||
    entry.audience !== expected ||
    !binding.success ||
    binding.data.audience !== expected
  )
    throw changedBrowserContext()
  return {
    ...privateBrowserHeaders(expected),
    [BROWSER_AUTH_HEADERS.binding]: anchor,
    [BROWSER_AUTH_HEADERS.contextId]: binding.data.contextId,
    [BROWSER_AUTH_HEADERS.generation]: String(binding.data.generation),
  }
}

/** Mandatory side-effect-free primary check before exposing a snapshot/token, including an expired access token. */
export function createBrowserBindingVerifier(source: Headers, expected: BrowserAudience) {
  const incoming = new Headers(source)
  return async (entry: VaultRecord): Promise<void> => {
    const headers = browserSessionHeaders(incoming, expected, entry)
    const binding = browserVaultBindingSchema.parse(entry.browser)
    let response: Response
    try {
      response = await fetchBackendResponse(
        `${getBackendBaseUrl()}/api/v1/auth/browser-publications/probe`,
        incoming,
        {
          method: 'POST',
          signal: AbortSignal.timeout(10000),
          cache: 'no-store',
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify({
            refreshToken: entry.refreshToken,
            familyId: binding.familyId,
            securityVersion: binding.securityVersion,
          }),
        }
      )
    } catch {
      throw unavailableBrowserContext()
    }
    if (response.status === 429)
      throw new ContextRequestError(
        429,
        'RATE_LIMIT_EXCEEDED',
        parseRetryAfterSeconds(response.headers)
      )
    if ([401, 403, 409].includes(response.status)) throw changedBrowserContext()
    if (!response.ok) throw unavailableBrowserContext()
    const checked = browserBindingProbeResultSchema.safeParse(
      await response.json().catch(() => null)
    )
    if (!checked.success) throw unavailableBrowserContext()
    const actual = checked.data
    if (
      actual.userId !== entry.userSnapshot.id ||
      actual.audience !== expected ||
      actual.contextId !== binding.contextId ||
      actual.generation !== binding.generation ||
      actual.familyId !== binding.familyId ||
      actual.securityVersion !== binding.securityVersion
    )
      throw changedBrowserContext()
  }
}

export function changedBrowserContext(): ContextRequestError {
  return new ContextRequestError(401, 'AUTH_CONTEXT_CHANGED')
}
export function unavailableBrowserContext(): ContextRequestError {
  return new ContextRequestError(503, 'SERVICE_UNAVAILABLE')
}
