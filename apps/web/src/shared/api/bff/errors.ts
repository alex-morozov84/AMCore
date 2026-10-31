/**
 * The vault store could not be reached (Redis down/unreachable). Callers
 * must treat this as "cannot authenticate right now" — never as "no
 * session" — per ADR-068's fail-closed requirement. Distinct from
 * `SessionNotFoundError` so the two can never be confused.
 */
export class SessionVaultUnavailableError extends Error {
  constructor(cause: unknown) {
    super('Session vault store is unavailable', { cause })
    this.name = 'SessionVaultUnavailableError'
  }
}

/**
 * The caller's own deadline for session admission passed (vault read, binding check or waiting for
 * the refresh owner). The caller leaves with a temporary error; the refresh owner, if one is
 * running, continues under its own budget. Not a statement about the session itself.
 */
export class SessionStageTimeoutError extends Error {
  constructor(readonly step: string) {
    super(`Session admission exceeded its deadline at ${step}`)
    this.name = 'SessionStageTimeoutError'
  }
}

/**
 * A refresh rotated the backend token, but the new credentials could not be approved or published
 * (binding check refused, unavailable or slow; publication not acknowledged). The owner ended the
 * attempt and tried a bounded delete of the vault entry. `cause` keeps the original status and code
 * so the response is not relabeled; a terminal result is not proof the entry was deleted.
 */
export class SessionPublicationUnprovenError extends Error {
  constructor(cause: unknown) {
    super('Refreshed session credentials could not be proven or published', { cause })
    this.name = 'SessionPublicationUnprovenError'
  }
}

/**
 * The backend answered the refresh with success (the refresh token is rotated server-side), but the
 * reply could not be read or understood. Unlike a request that got no response, the old token in
 * the vault is already stale, so the owner treats the attempt as a rotation that was not
 * published. `cause` keeps the original failure for diagnosis.
 */
export class UpstreamRotationUnprovenError extends Error {
  constructor(cause: unknown) {
    super('Upstream refresh succeeded but its reply could not be used', { cause })
    this.name = 'UpstreamRotationUnprovenError'
  }
}

/** No vault entry exists for this session id (logged out, expired, or never existed). */
export class SessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`No vault entry for session ${sessionId}`)
    this.name = 'SessionNotFoundError'
  }
}

/** Could not acquire the refresh lock within the bounded retry budget. */
export class SessionLockTimeoutError extends Error {
  constructor(sessionId: string) {
    super(`Timed out acquiring the refresh lock for session ${sessionId}`)
    this.name = 'SessionLockTimeoutError'
  }
}

/**
 * Lock renewal failed, or the refresh ran past the absolute ceiling, while
 * an upstream refresh was in flight. Either way exclusivity can no longer be
 * proven for the operation's whole duration, so the caller cannot tell
 * whether the backend completed the rotation after Next stopped waiting —
 * the vault's refresh token might already be stale. Treated as unsafe: the
 * vault entry is deleted rather than silently kept for a retry that could
 * trigger backend reuse-detection (ADR-068 round 2).
 */
export class SessionRefreshUnsafeError extends Error {
  constructor(sessionId: string) {
    super(`Refresh for session ${sessionId} lost provable exclusivity; treating it as unsafe`)
    this.name = 'SessionRefreshUnsafeError'
  }
}

/**
 * True only for an explicit backend rejection of the refresh token itself
 * (`invalid` / `reuse-detected`) — the one case ADR-068 requires deleting
 * the vault entry for. Everything else (network error, `timeout`, an
 * un-coded `Error`, a 5xx) is transient: fail the current request, but keep
 * the session so the next attempt can retry instead of silently logging the
 * user out during an ordinary API blip.
 */
export function isInvalidRefreshError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  return code === 'invalid' || code === 'reuse-detected'
}
