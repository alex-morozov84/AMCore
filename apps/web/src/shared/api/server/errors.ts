/**
 * Thrown by `fetchBackend()` for a failure that is deliberately not part of
 * the silent-degrade `DataOutcome` vocabulary: a rejected 4xx (a real
 * contract/auth error, not an infra hiccup) or a `2xx` payload that failed
 * the caller's Zod schema. Both must reach a real error boundary / uncaught-
 * error logging - never a quiet "no data".
 *
 * Deliberately carries no field a client-side error-boundary fallback
 * should ever read: a caught error's fields are not guaranteed to survive
 * unchanged from a Server Component to a client fallback, and even the
 * parts that do must not be shown to a user as-is. `status`/`correlationId`
 * exist for server-side logging, not for UI presentation.
 */
export class BackendRequestError extends Error {
  constructor(
    public readonly kind: 'rejected' | 'invalid-payload',
    public readonly correlationId: string,
    public readonly status?: number
  ) {
    super(`backend request ${kind} (status=${status ?? 'n/a'}, correlationId=${correlationId})`)
    this.name = 'BackendRequestError'
  }
}

/**
 * Thrown by `fetchBackend({ auth: 'required' })` when no session exists at
 * all - genuinely logged out, not an infrastructure failure. This is a
 * caller-contract error (the caller asserted this endpoint needs auth
 * without first checking that a session exists) and is deliberately kept
 * out of the availability vocabulary the same way a `401`/`403` response is
 * - see `types.ts`'s `DataOutcome` doc comment.
 */
export class BackendAuthRequiredError extends Error {
  constructor() {
    super('fetchBackend: auth "required" but no session exists')
    this.name = 'BackendAuthRequiredError'
  }
}
