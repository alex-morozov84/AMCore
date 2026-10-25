import type { SendEmailResult } from './email.types.js'

export type DirectSecretOutcome = 'accepted' | 'simulated' | 'not_started' | 'unknown'
export interface DirectSecretResult {
  outcome: DirectSecretOutcome
  reason:
    | 'provider_failure'
    | 'auth'
    | 'invalid_sender'
    | 'invalid_request'
    | 'rate_limit'
    | 'quota'
    | 'precheck'
    | null
}

/** Parsed SDK error names explain failure but do not independently establish a no-effect HTTP status. */
export function directSecretResult(
  result: SendEmailResult,
  mock: boolean,
  entered: boolean
): DirectSecretResult {
  if (!entered) return { outcome: 'not_started', reason: 'precheck' }
  if (result.success && !result.error && /^[A-Za-z0-9_-]{1,128}$/.test(result.id))
    return { outcome: mock ? 'simulated' : 'accepted', reason: null }
  const code = result.error ?? ''
  const reason = [
    'invalid_api_key',
    'missing_api_key',
    'restricted_api_key',
    'invalid_access',
  ].includes(code)
    ? 'auth'
    : code === 'invalid_from_address'
      ? 'invalid_sender'
      : code === 'rate_limit_exceeded'
        ? 'rate_limit'
        : ['daily_quota_exceeded', 'monthly_quota_exceeded'].includes(code)
          ? 'quota'
          : ['validation_error', 'invalid_parameter', 'invalid_idempotent_request'].includes(code)
            ? 'invalid_request'
            : 'provider_failure'
  return { outcome: 'unknown', reason }
}
