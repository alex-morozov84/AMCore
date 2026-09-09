import 'server-only'

// Direct server-to-apps/api transport (ADR-079). Server Components only -
// never import this from a Client Component or a browser-facing module.
export { getBackendAccessToken } from './access-token'
export { type AuthHeaderResult, type BackendAuthMode, resolveAuthHeader } from './auth-header'
export { type BackendFetchOptions, fetchBackend } from './backend-fetch'
export { classifyStatus, classifyThrown } from './classify'
export { generateCorrelationId } from './correlation-id'
export { createDeadlineController, type DeadlineController, withDeadline } from './deadline'
export {
  degradeSecondary,
  type SecondaryDegradeContext,
  type SecondaryRenderOutcome,
} from './degrade-secondary'
export { BackendAuthRequiredError, BackendRequestError } from './errors'
export { buildOutboundHeaders, type OutboundHeadersResult } from './outbound-headers'
export {
  isPrimaryUnavailableError,
  PrimaryUnavailableError,
  requirePrimary,
  type RequirePrimaryContext,
} from './require-primary'
export { type JsonBodyResult, readJsonBody } from './response-body'
export type { DataOutcome, UnavailableReason } from './types'
