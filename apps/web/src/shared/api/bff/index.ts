import 'server-only'

// BFF session-vault public API (ADR-068). Never import this from a Client
// Component — it handles real backend credentials.
export { ensureFreshSession, type EnsureFreshSessionDeps } from './ensure-fresh-session'
export {
  isInvalidRefreshError,
  SessionLockTimeoutError,
  SessionNotFoundError,
  SessionRefreshUnsafeError,
  SessionVaultUnavailableError,
} from './errors'
export { getWebRedisClient } from './redis-client'
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
