import { ContextRequestError } from '@/shared/api/bff/context-errors'
import {
  SessionLockTimeoutError,
  SessionNotFoundError,
  SessionVaultUnavailableError,
} from '@/shared/api/bff/errors'
import { InvitationBackendError } from '@/shared/api/bff/invitation-upstream'
import type { DataOutcome } from '@/shared/api/server'

import 'server-only'

/** Only declared stale authority is ordinary; unexpected 4xx/contracts/bugs escape. */
export function isExpectedInvitationState(error: unknown): boolean {
  return (
    error instanceof SessionNotFoundError ||
    (error instanceof ContextRequestError &&
      [
        'INVITE_INVALID_OR_EXPIRED',
        'INVITE_FLOW_CHANGED',
        'INVITE_FLOW_BUSY',
        'UNAUTHORIZED',
        'FORBIDDEN',
        'AUTH_ORIGIN_REJECTED',
      ].includes(error.errorCode))
  )
}

export function invitationUnavailableOutcome(error: unknown): DataOutcome<never> | null {
  if (error instanceof InvitationBackendError && error.category === 'contract') return null
  const status =
    error instanceof ContextRequestError || error instanceof InvitationBackendError
      ? error.status
      : undefined
  const reason =
    error instanceof SessionVaultUnavailableError
      ? 'upstream'
      : error instanceof SessionLockTimeoutError
        ? 'timeout'
        : status === 429
          ? 'rate-limited'
          : status !== undefined && status >= 500
            ? 'upstream'
            : error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)
              ? 'timeout'
              : null
  if (!reason) return null
  const retry =
    error instanceof ContextRequestError || error instanceof InvitationBackendError
      ? error.retryAfterSeconds
      : undefined
  return {
    status: 'unavailable',
    reason,
    retryAfterMs: retry === undefined ? undefined : retry * 1000,
  }
}
