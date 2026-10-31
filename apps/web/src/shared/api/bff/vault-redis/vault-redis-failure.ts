import {
  AbortError,
  ClientClosedError,
  ClientOfflineError,
  ConnectionTimeoutError,
  DisconnectsClientError,
  ReconnectStrategyError,
  SimpleError,
  SocketClosedUnexpectedlyError,
  SocketTimeoutError,
  TimeoutError,
} from '@redis/client'

import { VaultRedisError } from './vault-redis-types'

/** Transport lifecycle errors of `@redis/client` 6.3.0 (frozen from observed faults). */
const LIFECYCLE_ERRORS = [
  AbortError,
  ClientClosedError,
  ClientOfflineError,
  ConnectionTimeoutError,
  DisconnectsClientError,
  ReconnectStrategyError,
  SocketClosedUnexpectedlyError,
  SocketTimeoutError,
  TimeoutError,
] as const

const TRANSPORT_CODES = new Set([
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'ETIMEDOUT',
])
// `OOM` is a saturated Redis refusing writes: the vault is unavailable for a write.
const OPERATIONAL_REPLY = /^(LOADING|BUSY|MASTERDOWN|TRYAGAIN|CLUSTERDOWN|OOM)\b/
const MAX_CAUSE_DEPTH = 4

/**
 * True only when the failure proves Redis is unavailable, slow or saturated. Programming and
 * schema errors (`TypeError`, `WRONGTYPE`, script errors, any other server reply) return false,
 * so they stay visible instead of looking like an outage. A `dispatch` failure is a bug, never an
 * outage; the outcome of an operation comes from its phase, not from the transport cause.
 */
export function isVaultRedisUnavailable(error: unknown, depth = 0): boolean {
  if (depth > MAX_CAUSE_DEPTH || !(error instanceof Error)) return false
  if (error instanceof VaultRedisError) {
    if (error.reason === 'dispatch') return false
    if (error.reason === 'command') return isVaultRedisUnavailable(error.cause, depth + 1)
    return true
  }
  if (error instanceof SimpleError) return OPERATIONAL_REPLY.test(error.message)
  if (LIFECYCLE_ERRORS.some((type) => error instanceof type)) return true
  const code = (error as { code?: unknown }).code
  if (typeof code === 'string' && TRANSPORT_CODES.has(code)) return true
  return error.cause === undefined ? false : isVaultRedisUnavailable(error.cause, depth + 1)
}
