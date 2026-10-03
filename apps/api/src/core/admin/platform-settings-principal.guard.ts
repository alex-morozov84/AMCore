import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common'

import type { RequestPrincipal } from '@amcore/shared'

import { ForbiddenException } from '@/common/exceptions'

/** Platform settings cannot be reached with an organization-exchanged credential. */
@Injectable()
export class PlatformSettingsPrincipalGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest<{ user?: RequestPrincipal }>()
    if (!user || user.type !== 'jwt' || user.organizationId !== undefined)
      throw new ForbiddenException('Personal platform credential required')
    return true
  }
}
