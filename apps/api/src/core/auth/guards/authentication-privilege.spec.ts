import type { ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { AuthType, type RequestPrincipal, SystemRole } from '@amcore/shared'

import type { ApiKeyGuard } from '../../api-keys/guards/api-key.guard'
import type { AbilityFactory } from '../casl/ability.factory'
import { PrivilegedAdmissionService } from '../privileged-admission.service'
import type { PrivilegedRoleService } from '../privileged-role.service'

import { AuthenticationGuard } from './authentication.guard'
import type { JwtAuthGuard } from './jwt-auth.guard'
import type { PoliciesGuard } from './policies.guard'
import { SystemRolesGuard } from './system-roles.guard'
import type { TeamAccessGuard } from './team-access.guard'

it('normalizes privilege before ability and every downstream guard, outside auth fallback', async () => {
  const order: string[] = []
  const principal: RequestPrincipal = {
    type: 'jwt',
    sub: 'actor',
    systemRole: SystemRole.SuperAdmin,
  }
  const request = { user: principal, ability: undefined }
  const ctx = {
    getHandler: () => Object,
    getClass: () => Object,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext
  const reflector = {
    getAllAndOverride: (key: string) =>
      key === 'authType' ? [AuthType.Bearer, AuthType.ApiKey] : undefined,
  } as unknown as Reflector
  const key = { canActivate: jest.fn() }
  const roles = {
    getCurrentSystemRole: jest.fn(async () => {
      order.push('primary')
      return SystemRole.User
    }),
  }
  const factory = {
    createAuthorizationContext: jest.fn(async (admission) => {
      order.push('ability')
      expect(request.user).toBe(admission.principal)
      expect(admission.authenticated.systemRole).toBe(SystemRole.SuperAdmin)
      expect(request.user.systemRole).toBe(SystemRole.User)
      return { ability: {}, teamAccess: {} }
    }),
  }
  const policies = {
    canActivate: async () => {
      order.push('policy')
      expect(request.user.systemRole).toBe(SystemRole.User)
      return true
    },
  }
  const team = {
    canActivate: async () => {
      order.push('team')
      expect(request.user.systemRole).toBe(SystemRole.User)
      return true
    },
  }
  const guard = new AuthenticationGuard(
    reflector,
    {
      canActivate: async () => {
        order.push('auth')
        return true
      },
    } as unknown as JwtAuthGuard,
    key as unknown as ApiKeyGuard,
    factory as unknown as AbilityFactory,
    new SystemRolesGuard(reflector),
    policies as unknown as PoliciesGuard,
    team as unknown as TeamAccessGuard,
    new PrivilegedAdmissionService(roles as unknown as PrivilegedRoleService)
  )
  await guard.canActivate(ctx)
  expect(order).toEqual(['auth', 'primary', 'ability', 'policy', 'team'])
  expect(key.canActivate).not.toHaveBeenCalled()
  const outage = new Error('primary unavailable')
  request.user = principal
  factory.createAuthorizationContext.mockClear()
  roles.getCurrentSystemRole.mockRejectedValueOnce(outage)
  await expect(guard.canActivate(ctx)).rejects.toBe(outage)
  expect(factory.createAuthorizationContext).not.toHaveBeenCalled()
  expect(key.canActivate).not.toHaveBeenCalled()
})
