import type { RequestPrincipal } from '@amcore/shared'

import type { AppAbility } from '../casl/ability.factory'

/**
 * Extend Express Request type to include auth-related properties
 */
declare global {
  namespace Express {
    interface Request {
      /**
       * Authenticated user principal (populated by JWT/ApiKey strategies)
       */
      user?: RequestPrincipal

      /**
       * CASL ability instance (populated by AuthenticationGuard)
       * Used for authorization checks in services via accessibleBy()
       */
      ability?: AppAbility
    }
  }
}
