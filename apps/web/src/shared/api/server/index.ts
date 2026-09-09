import 'server-only'

// Direct server-to-`apps/api` transport (ADR-079). Server Components only —
// never import this from a Client Component or a browser-facing module.
export { getBackendAccessToken } from './access-token'
export { type BackendFetchOptions, fetchBackend } from './backend-fetch'
export { classifyStatus, classifyThrown } from './classify'
export { generateCorrelationId } from './correlation-id'
export { degradeSecondary, type SecondaryDegradeContext } from './degrade-secondary'
export { BackendRequestError } from './errors'
export { PrimaryUnavailableError, requirePrimary } from './require-primary'
export type { DataOutcome, UnavailableReason } from './types'
