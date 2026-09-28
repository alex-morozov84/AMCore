import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { type SystemRole } from '@amcore/shared'

import { ForbiddenException } from '../../../common/exceptions'
import { SYSTEM_ROLES_KEY } from '../decorators/system-roles.decorator'

/** Exact original-credential AND primary-role requirement, using admission evidence. */
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
    if (
      !user ||
      !admission ||
      admission.principal !== user ||
      !required.includes(admission.authenticated.systemRole) ||
      !admission.currentRole ||
      !required.includes(admission.currentRole)
    ) {
      throw new ForbiddenException('Insufficient system role')
    }
    return true
  }
}
