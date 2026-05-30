import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { type SystemRole } from '@amcore/shared'

import { ForbiddenException } from '../../../common/exceptions'
import { SYSTEM_ROLES_KEY } from '../decorators/system-roles.decorator'
import { PrivilegedRoleService } from '../privileged-role.service'

/**
 * SystemRolesGuard
 *
 * Validates that user has required system role (server-wide permission).
 *
 * System roles are different from organization roles:
 * - SUPER_ADMIN: Full server access (admin panel, all orgs, system config)
 * - USER: Regular authenticated user
 *
 * Flow:
 * 1. Reflector extracts required roles from @SystemRoles decorator
 * 2. Gets user from request (populated by AuthenticationGuard)
 * 3. Checks if user.systemRole is in required roles
 *
 * Usage:
 * ```typescript
 * @SystemRoles(SystemRole.SuperAdmin)
 * @Get('admin/users')
 * listAllUsers() {}
 * ```
 */
@Injectable()
export class SystemRolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly privilegedRole: PrivilegedRoleService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Get required system roles from @SystemRoles decorator
    const requiredRoles = this.reflector.getAllAndOverride<SystemRole[]>(SYSTEM_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ])

    // If no roles specified, allow access. No DB read — this is every
    // non-@SystemRoles route, i.e. all ordinary authenticated traffic.
    if (!requiredRoles || requiredRoles.length === 0) {
      return true
    }

    // Get user from request
    const request = context.switchToHttp().getRequest()
    const user = request.user

    // Claim check first — cheap, no DB read. Throw rather than return false:
    // Nest would otherwise convert false into a raw ForbiddenException without
    // our domain errorCode. This also closes the stale-promotion gap
    // (OB-06a / ADR-037, threat T4): a just-promoted user's old token still
    // carries the pre-promotion claim, is rejected here, and never reaches the
    // DB read or the route.
    if (!user || !requiredRoles.includes(user.systemRole)) {
      throw new ForbiddenException('Insufficient system role')
    }

    // Current-role check (OB-06a / ADR-037). The JWT `systemRole` claim is
    // NECESSARY BUT NOT SUFFICIENT for privileged routes. Re-read the CURRENT
    // role straight from Postgres (PrivilegedRoleService, never the cache) and
    // require it to satisfy the requirement too, so a demoted SUPER_ADMIN loses
    // access on the next request even while the pre-demotion access token is
    // still cryptographically valid (threat T1). Effective decision =
    // claim ∩ current-DB-role — the "lower-privilege of the two" invariant.
    // This looks redundant with the claim check above but is not: each guards a
    // different staleness direction (promotion above, demotion here). A `null`
    // current role (user hard-deleted) is fail-closed → deny. A DB lookup
    // failure is intentionally NOT caught — it propagates to the global filters
    // (503 via ADR-032), which is fail-closed (never a grant) and observable,
    // rather than masked as a 403.
    const currentRole = await this.privilegedRole.getCurrentSystemRole(user.sub)
    if (!currentRole || !requiredRoles.includes(currentRole)) {
      throw new ForbiddenException('Insufficient system role')
    }

    return true
  }
}
