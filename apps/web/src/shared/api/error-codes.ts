/**
 * Client-side error codes.
 *
 * ADR-023 has the backend emit a machine-readable `errorCode` that the frontend
 * translates. Some failures never reach the backend at all — the network is
 * down, the request timed out, or the response carried no code. Giving those
 * conditions codes of the same shape means every error, wherever it originated,
 * flows through one translation path instead of a second ad-hoc one.
 *
 * These names must not collide with any backend enum value; the coverage test
 * asserts that.
 */
export const ClientErrorCode = {
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT: 'TIMEOUT',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
  AUTH_CONTINUATION_CHANGED: 'AUTH_CONTINUATION_CHANGED',
} as const

export type ClientErrorCodeValue = (typeof ClientErrorCode)[keyof typeof ClientErrorCode]

/** A local state failure carries no fabricated HTTP response or backend diagnostics. */
export class ClientStateError extends Error {
  constructor(public readonly code: ClientErrorCodeValue) {
    super(code)
    this.name = 'ClientStateError'
  }
}
