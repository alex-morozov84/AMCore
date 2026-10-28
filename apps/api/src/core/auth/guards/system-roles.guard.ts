import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { SystemRole } from '@amcore/shared'

import { ForbiddenException } from '../../../common/exceptions/index.js'
import { SYSTEM_ROLES_KEY } from '../decorators/system-roles.decorator.js'

/** JWT grants intersect original/current roles. API keys always have effective system role USER. */
@Injectable()
export class SystemRolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  requiredRoles(context: ExecutionContext): SystemRole[] {
    return (
      this.reflector.getAllAndOverride<SystemRole[]>(SYSTEM_ROLES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? []
    )
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.requiredRoles(context)
    if (required.length === 0) return true
    const { user, privilegedAdmission: admission } = context.switchToHttp().getRequest()
    const originalRole =
      user?.type === 'api_key' ? SystemRole.User : admission?.authenticated.systemRole
    const currentRole = user?.type === 'api_key' ? SystemRole.User : admission?.currentRole
    if (
      !user ||
      !admission ||
      admission.principal !== user ||
      !required.includes(originalRole) ||
      !currentRole ||
      !required.includes(currentRole)
    ) {
      throw new ForbiddenException('Insufficient system role')
    }
    return true
  }
}
