import 'server-only'

// Direct server-to-apps/api transport (ADR-079). Server Components only -
// never import this from a Client Component or a browser-facing module.
export { type BackendFetchOptions, fetchBackend } from './backend-fetch'
export {
  degradeSecondary,
  type SecondaryDegradeContext,
  type SecondaryRenderOutcome,
} from './degrade-secondary'
export { BackendAuthRequiredError, BackendRequestError } from './errors'
export {
  PrimaryUnavailableError,
  requirePrimary,
  type RequirePrimaryContext,
} from './require-primary'
export type { DataOutcome, UnavailableReason } from './types'
