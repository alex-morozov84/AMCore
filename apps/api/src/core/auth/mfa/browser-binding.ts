import {
  type BrowserAudience,
  browserAudienceSchema,
  type BrowserRevision,
  browserRevisionSchema,
} from '@amcore/shared'

import { mfaHash } from './mfa-secrets.js'

export interface BrowserRequestBinding extends BrowserRevision {
  audience: BrowserAudience
  bindingHash: string
}

export function hashBrowserBinding(binding: unknown): string | null {
  return typeof binding === 'string' && /^[A-Za-z0-9_-]{43}$/.test(binding)
    ? mfaHash(JSON.stringify(['browser-binding-v1', binding]))
    : null
}

/** Normalize only after trusted BFF transport validation; this grants no actor authority. */
export function browserRequestBinding(
  binding: unknown,
  audience: unknown,
  revision: unknown
): BrowserRequestBinding | null {
  const hash = hashBrowserBinding(binding)
  const scope = browserAudienceSchema.safeParse(audience)
  const expected = browserRevisionSchema.safeParse(revision)
  if (!hash || !scope.success || !expected.success) return null
  return Object.freeze({ ...expected.data, audience: scope.data, bindingHash: hash })
}
