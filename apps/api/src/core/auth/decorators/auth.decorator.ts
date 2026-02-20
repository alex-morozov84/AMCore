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
 * @Auth(AuthType.None)               // Public route
 * @Auth(AuthType.Bearer)             // JWT only (default, no decorator needed)
 * @Auth(AuthType.Bearer, AuthType.ApiKey)  // JWT or API key
 * ```
 *
 * Default (no decorator): [AuthType.Bearer]
 *
 * @param types - One or more auth types to accept
 */
export const Auth = (...types: AuthType[]): CustomDecorator<string> =>
  SetMetadata(AUTH_TYPE_KEY, types)
