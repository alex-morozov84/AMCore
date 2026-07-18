import type { SystemRole } from '../enums/roles'

// What gets encoded into JWT token
export interface JwtPayload {
  sub: string
  email: string
  systemRole: SystemRole
  organizationId?: string
  aclVersion?: number
  // OB-06b / ADR-037: session id this access token was minted for. Consumed
  // only by FreshAuthGuard on @RequireFreshAuth routes to look up
  // Session.lastAuthAt. Optional — legacy tokens lack it and fail closed on
  // step-up routes only.
  sid?: string
  // Standard JWT expiry claim (epoch seconds). Set by `jsonwebtoken` from the
  // sign `expiresIn` option, so it is not passed at sign time but is present on
  // the verified payload. Typed here so `JwtStrategy.validate` can carry it into
  // the principal to bound long-lived SSE streams (ADR-053).
  exp?: number
}
