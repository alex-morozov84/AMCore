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
 * @Auth(AuthType.Bearer)                   // JWT only (also the default)
 * @Auth(AuthType.Bearer, AuthType.ApiKey)  // JWT or API key (must be in ADR-034 allowlist)
 * ```
 *
 * **Runtime default (no decorator):** `[AuthType.Bearer]` per ADR-034.
 * Routes without `@Auth(...)` are JWT-only. To make a route public
 * declare `@Auth(AuthType.None)` explicitly. To opt in to API-key
 * acceptance declare `@Auth(AuthType.Bearer, AuthType.ApiKey)` AND
 * extend the ADR-034 allowlist via an ADR amendment — the metadata
 * test in `auth-decorator-coverage.spec.ts` enforces both checks.
 *
 * `apps/api/src/core/**` controllers additionally must declare
 * `@Auth(...)` explicitly (handler- or class-level) so the auth-types
 * matrix is auditable. The "explicit declaration" check stays alongside
 * the allowlist check as defense in depth.
 *
 * See ADR-034 (Auth Default — Bearer-Only) and
 * `ai/ORGANIZATIONS_ADMIN_REVIEW.md` OA-11.
 *
 * @param types - One or more auth types to accept
 */
export const Auth = (...types: AuthType[]): CustomDecorator<string> =>
  SetMetadata(AUTH_TYPE_KEY, types)
