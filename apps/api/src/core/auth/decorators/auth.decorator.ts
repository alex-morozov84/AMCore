import { type CustomDecorator, SetMetadata } from '@nestjs/common'

import { AuthType } from '@amcore/shared'

/**
 * Metadata key for auth types
 */
export const AUTH_TYPE_KEY = 'authType'

/**
 * @Auth() decorator - Specify authentication types for a route
 *
 * Replaces @Public() and allows multiple auth methods.
 *
 * Usage:
 * ```typescript
 * @Auth(AuthType.None)                     // Public route
 * @Auth(AuthType.Bearer)                   // JWT only
 * @Auth(AuthType.Bearer, AuthType.ApiKey)  // JWT or API key
 * ```
 *
 * **Runtime default (no decorator):** `[AuthType.Bearer, AuthType.ApiKey]`.
 * That default is permissive — any controller that forgets to declare
 * `@Auth(...)` silently accepts API keys, including on routes that
 * mint JWTs or perform platform-admin operations (`OA-01`/`OA-02`/
 * `OA-11`).
 *
 * The starter is in transition to a bearer-only default. Stage 1a (this
 * pass) sweeps every controller in `apps/api/src/core/**` to declare
 * `@Auth(...)` explicitly so the matrix is auditable and the metadata
 * test in `auth-decorator-coverage.spec.ts` can enforce the discipline.
 * Stage 1c flips the runtime default in `AuthenticationGuard` to
 * `[AuthType.Bearer]` — gated by ADR-034 (Auth Default — Bearer-Only).
 * After Stage 1c the "(no decorator)" wording in this JSDoc must be
 * updated and the metadata test inverted to check that the explicit
 * `AuthType.ApiKey` opt-in matches an ADR-034 allowlist.
 *
 * See `ai/ORGANIZATIONS_ADMIN_REVIEW.md` OA-11 and ADR-024 (to be
 * superseded by ADR-034).
 *
 * @param types - One or more auth types to accept
 */
export const Auth = (...types: AuthType[]): CustomDecorator<string> =>
  SetMetadata(AUTH_TYPE_KEY, types)
