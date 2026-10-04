import { ERROR_TRANSLATION_KEYS } from '@bull-board/api/dist/schemas/errorKeys.js'
import type { ControllerHandlerReturnType, HTTPStatus } from '@bull-board/api/typings/app'

/**
 * Final boundary of the board's API responses (runs AFTER the board's own response validation).
 *
 * Any status >= 400 — a thrown error, an `errorResponse(...)` from a handler or hook, or the board's
 * own `RESPONSE_SCHEMA_MISMATCH` (which carries the validator's issue text, possibly the offending
 * value) — is reduced to `{ error: { key } }`: the translation key the board UI already knows, and
 * nothing else. No `message`, `details`, `code`, `options` or stack ever leaves. The status is kept.
 */
const KNOWN_KEYS: ReadonlySet<string> = new Set(ERROR_TRANSLATION_KEYS)

const KEY_BY_STATUS: Readonly<Record<number, string>> = {
  400: 'ERRORS.INVALID_QUERY_PARAM',
  403: 'ERRORS.FORBIDDEN',
  404: 'ERRORS.QUEUE_NOT_FOUND',
}

const FALLBACK_KEY = 'ERRORS.INTERNAL_SERVER_ERROR'

export function safeErrorResult(status: HTTPStatus, key?: unknown): ControllerHandlerReturnType {
  const known = typeof key === 'string' && KNOWN_KEYS.has(key) ? key : undefined
  return { status, body: { error: { key: known ?? KEY_BY_STATUS[status] ?? FALLBACK_KEY } } }
}

function errorKeyOf(body: unknown): unknown {
  if (typeof body !== 'object' || body === null) return undefined
  const error = (body as { error?: unknown }).error
  if (typeof error === 'string') return error
  return typeof error === 'object' && error !== null ? (error as { key?: unknown }).key : undefined
}

export function finalizeResult(result: ControllerHandlerReturnType): ControllerHandlerReturnType {
  const status = result.status ?? 200
  if (status < 400) return result
  return safeErrorResult(status, errorKeyOf(result.body))
}

/** Wraps a board route handler: never lets a thrown error or a raw error body escape. */
export function withFinalBoundary<TRequest>(
  handler: (request: TRequest) => ControllerHandlerReturnType | Promise<ControllerHandlerReturnType>
): (request: TRequest) => Promise<ControllerHandlerReturnType> {
  return async (request) => {
    try {
      return finalizeResult(await handler(request))
    } catch {
      return safeErrorResult(500)
    }
  }
}
