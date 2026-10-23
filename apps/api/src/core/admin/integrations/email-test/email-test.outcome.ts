import type { ProbeReceipt } from '@amcore/shared'

import type { SendEmailResult } from '../../../../infrastructure/email/email.types.js'

export interface ProbeResult {
  outcome: Extract<ProbeReceipt['outcome'], 'accepted' | 'simulated' | 'refused' | 'unknown'>
  class: ProbeReceipt['class']
}

const AUTH = new Set(['missing_api_key', 'invalid_api_key', 'restricted_api_key', 'invalid_access'])
const SENDER = new Set(['invalid_from_address'])
const REQUEST = new Set([
  'validation_error',
  'missing_required_field',
  'invalid_parameter',
  'invalid_attachment',
  'invalid_region',
  'method_not_allowed',
  'invalid_idempotency_key',
  'invalid_idempotent_request',
])
const LIMIT = new Set(['rate_limit_exceeded'])
const QUOTA = new Set(['daily_quota_exceeded', 'monthly_quota_exceeded'])

/**
 * `refused` only for an explicit, deterministic provider rejection. Everything else is `unknown`,
 * including `provider_failure` (malformed 200, network loss, unrecognised error) and a named
 * limit: the installed SDK returns the parsed error body without an HTTP status, so a limit does
 * not prove that nothing was accepted. Class names only; never provider text.
 */
export function classifySend(provider: 'resend' | 'mock', result: SendEmailResult): ProbeResult {
  if (result.success)
    return provider === 'mock'
      ? { outcome: 'simulated', class: null }
      : result.id
        ? { outcome: 'accepted', class: null }
        : { outcome: 'unknown', class: null }
  const code = result.error ?? ''
  if (AUTH.has(code)) return { outcome: 'refused', class: 'auth' }
  if (SENDER.has(code)) return { outcome: 'refused', class: 'invalid_sender' }
  if (REQUEST.has(code)) return { outcome: 'refused', class: 'invalid_request' }
  if (LIMIT.has(code)) return { outcome: 'unknown', class: 'rate_limit' }
  if (QUOTA.has(code)) return { outcome: 'unknown', class: 'quota' }
  return { outcome: 'unknown', class: null }
}
