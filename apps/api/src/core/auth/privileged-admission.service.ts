import { Injectable } from '@nestjs/common'

import { type RequestPrincipal, type SystemRole as Role, SystemRole } from '@amcore/shared'

import { UnauthorizedException } from '../../common/exceptions'

import { PrivilegedRoleService } from './privileged-role.service'

/** Request-local evidence; original credential facts never become effective grants. */
export interface PrivilegedAdmission {
  readonly authenticated: Readonly<RequestPrincipal>
  readonly principal: RequestPrincipal
  readonly currentRole?: Role
}

@Injectable()
export class PrivilegedAdmissionService {
  constructor(private readonly roles: PrivilegedRoleService) {}

  async resolve(
    principal: RequestPrincipal,
    requiredRoles: Role[] = []
  ): Promise<PrivilegedAdmission> {
    const authenticated = Object.freeze({
      ...principal,
      ...(principal.scopes && {
        scopes: Object.freeze([...principal.scopes]) as unknown as string[],
      }),
    })
    // ApiKeyGuard obtained this owner role directly from primary during authentication.
    const needsCurrentRole =
      principal.systemRole === SystemRole.SuperAdmin || requiredRoles.includes(principal.systemRole)
    const currentRole =
      principal.type === 'api_key'
        ? principal.systemRole
        : needsCurrentRole
          ? await this.roles.getCurrentSystemRole(principal.sub)
          : undefined
    if (currentRole === null) throw new UnauthorizedException('User not found')
    const systemRole =
      principal.systemRole === SystemRole.SuperAdmin && currentRole !== SystemRole.SuperAdmin
        ? SystemRole.User
        : principal.systemRole
    return Object.freeze({ authenticated, principal: { ...principal, systemRole }, currentRole })
  }
}
