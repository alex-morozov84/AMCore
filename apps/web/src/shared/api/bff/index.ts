import 'server-only'

// BFF session-vault public API (ADR-068). Never import this from a Client
// Component — it handles real backend credentials.
export { type ApiErrorParams, apiErrorResponse, zodValidationErrors } from './api-error-response'
export { proxyToBackend } from './authenticated-proxy'
export { type CredentialAuthOptions, handleCredentialAuth } from './credential-auth-handler'
export { ensureFreshSession, type EnsureFreshSessionDeps } from './ensure-fresh-session'
export {
  isInvalidRefreshError,
  SessionLockTimeoutError,
  SessionNotFoundError,
  SessionRefreshUnsafeError,
  SessionVaultUnavailableError,
} from './errors'
export { type MintedSession, mintSession, type MintSessionParams } from './mint-session'
export { isTrustedOrigin } from './origin-guard'
export { forwardRequestHeaders, forwardResponseHeaders } from './proxy-headers'
export { getWebRedisClient } from './redis-client'
export { SESSION_COOKIE_NAME, sessionCookieOptions } from './session-cookie'
export { redisVaultLock } from './session-lock'
export type {
  NewVaultEntry,
  UpstreamRefreshError,
  UpstreamRefreshErrorCode,
  UpstreamRefreshFn,
  UpstreamRefreshResult,
  VaultEntry,
  VaultLock,
  VaultStore,
} from './session-vault.types'
export { redisVaultStore } from './session-vault-store'
export { extractCookieValue } from './set-cookie'
export { callUpstreamAuth, UpstreamAuthError, type UpstreamAuthResult } from './upstream-auth'
export { upstreamRefresh } from './upstream-refresh'
export { ACCESS_TOKEN_LIFETIME_MS, VAULT_TTL_SECONDS } from './vault-constants'
