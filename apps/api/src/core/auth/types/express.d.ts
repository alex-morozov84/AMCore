import type { RequestPrincipal } from '@amcore/shared'

import type { AppAbility } from '../casl/ability.factory'
import type { PrivilegedAdmission } from '../privileged-admission.service'

/**
 * Extend Express Request type to include auth-related properties
 */
declare global {
  namespace Express {
    interface Request {
      /**
       * Authenticated principal, then effective privilege projection before authorization.
       */
      user?: RequestPrincipal

      /** Primary privilege evidence, retained separately from effective user. */
      privilegedAdmission?: PrivilegedAdmission

      /**
       * CASL ability instance (populated by AuthenticationGuard)
       * Used for authorization checks in services via accessibleBy()
       */
      ability?: AppAbility
    }
  }
}
