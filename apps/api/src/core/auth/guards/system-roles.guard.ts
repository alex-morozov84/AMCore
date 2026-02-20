import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { type SystemRole } from '@amcore/shared'

import { SYSTEM_ROLES_KEY } from '../decorators/system-roles.decorator'

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
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Get required system roles from @SystemRoles decorator
    const requiredRoles = this.reflector.get<SystemRole[]>(SYSTEM_ROLES_KEY, context.getHandler())

    // If no roles specified, allow access
    if (!requiredRoles || requiredRoles.length === 0) {
      return true
    }

    // Get user from request
    const request = context.switchToHttp().getRequest()
    const user = request.user

    // If no user, deny access
    if (!user) {
      return false
    }

    // Check if user has any of the required system roles
    return requiredRoles.includes(user.systemRole)
  }
}
