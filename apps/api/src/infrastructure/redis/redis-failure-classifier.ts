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

import { BoundedRedisError } from './bounded-redis.js'

/** Transport lifecycle errors of `@redis/client` 6.3.0 (frozen from observed faults, not guessed). */
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

/** Server replies that mean "the dependency cannot serve right now", matched by reply prefix. */
const OPERATIONAL_REPLY = /^(LOADING|BUSY|MASTERDOWN|TRYAGAIN|CLUSTERDOWN)\b/

const MAX_CAUSE_DEPTH = 4

/**
 * True only when the failure proves Redis is unavailable, slow or saturated: transport and
 * lifecycle errors, a missed deadline, refused capacity, or an operational server reply.
 * Programming and schema errors (`TypeError`, `WRONGTYPE`, script errors, any other server
 * reply) return false, so they stay visible as 500 instead of looking like an outage.
 *
 * `BoundedRedisError.cause` is unwrapped; the outcome of an operation always comes from its
 * phase (`BoundedRedisError.outcome`), never from the transport cause: a closed connection
 * does not prove the command was never sent.
 */
export function isRedisUnavailable(error: unknown, depth = 0): boolean {
  if (depth > MAX_CAUSE_DEPTH || !(error instanceof Error)) return false
  if (error instanceof BoundedRedisError) {
    if (error.reason === 'dispatch') return false
    if (error.reason === 'command') return isRedisUnavailable(error.cause, depth + 1)
    return true
  }
  if (error instanceof SimpleError) return OPERATIONAL_REPLY.test(error.message)
  if (LIFECYCLE_ERRORS.some((type) => error instanceof type)) return true
  const code = (error as { code?: unknown }).code
  if (typeof code === 'string' && TRANSPORT_CODES.has(code)) return true
  return error.cause === undefined ? false : isRedisUnavailable(error.cause, depth + 1)
}
