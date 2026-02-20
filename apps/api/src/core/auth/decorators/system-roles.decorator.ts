import { type CustomDecorator, SetMetadata } from '@nestjs/common'

import { SystemRole } from '@amcore/shared'

/**
 * Metadata key for system roles
 */
export const SYSTEM_ROLES_KEY = 'systemRoles'

/**
 * @SystemRoles() decorator - Restrict route to specific system roles
 *
 * System roles are server-wide (not organization-specific).
 *
 * Usage:
 * ```typescript
 * @SystemRoles(SystemRole.SuperAdmin)
 * @Get('admin/users')
 * listAllUsers() {}
 * ```
 *
 * Multiple roles (user must have at least one):
 * ```typescript
 * @SystemRoles(SystemRole.SuperAdmin, SystemRole.User)
 * ```
 *
 * @param roles - One or more system roles required
 */
export const SystemRoles = (...roles: SystemRole[]): CustomDecorator<string> =>
  SetMetadata(SYSTEM_ROLES_KEY, roles)
