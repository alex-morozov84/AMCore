import type { ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { type RequestPrincipal, SystemRole } from '@amcore/shared'

import { ForbiddenException } from '../../../common/exceptions'
import type { PrivilegedAdmission } from '../privileged-admission.service'

import { SystemRolesGuard } from './system-roles.guard'

function context(admission?: PrivilegedAdmission, user = admission?.principal): ExecutionContext {
  return {
    getHandler: () => context,
    getClass: () => SystemRolesGuard,
    switchToHttp: () => ({ getRequest: () => ({ user, privilegedAdmission: admission }) }),
  } as unknown as ExecutionContext
}
function evidence(claim: SystemRole, currentRole?: SystemRole): PrivilegedAdmission {
  const authenticated: RequestPrincipal = { type: 'jwt', sub: 'actor', systemRole: claim }
  return {
    authenticated,
    currentRole,
    principal: {
      ...authenticated,
      systemRole:
        claim === SystemRole.SuperAdmin && currentRole !== claim ? SystemRole.User : claim,
    },
  }
}

describe('SystemRolesGuard', () => {
  const getAllAndOverride = jest.fn()
  const guard = new SystemRolesGuard({ getAllAndOverride } as unknown as Reflector)
  beforeEach(() => getAllAndOverride.mockReset())

  it('allows routes without metadata, but missing admission never grants a required role', async () => {
    await expect(guard.canActivate(context())).resolves.toBe(true)
    getAllAndOverride.mockReturnValue([SystemRole.SuperAdmin])
    await expect(guard.canActivate(context())).rejects.toThrow(ForbiddenException)
  })

  it('allows only when both original claim and primary role are privileged', async () => {
    getAllAndOverride.mockReturnValue([SystemRole.SuperAdmin])
    await expect(
      guard.canActivate(context(evidence(SystemRole.SuperAdmin, SystemRole.SuperAdmin)))
    ).resolves.toBe(true)
  })

  it.each([
    [SystemRole.SuperAdmin, SystemRole.User],
    [SystemRole.User, SystemRole.SuperAdmin],
    [SystemRole.SuperAdmin, undefined],
  ])('denies original claim %s with current role %s', async (claim, current) => {
    getAllAndOverride.mockReturnValue([SystemRole.SuperAdmin])
    await expect(guard.canActivate(context(evidence(claim, current)))).rejects.toThrow(
      ForbiddenException
    )
  })

  it('projected USER after demotion is not an original USER claim', async () => {
    getAllAndOverride.mockReturnValue([SystemRole.User])
    await expect(
      guard.canActivate(context(evidence(SystemRole.SuperAdmin, SystemRole.User)))
    ).rejects.toThrow(ForbiddenException)
    await expect(
      guard.canActivate(context(evidence(SystemRole.User, SystemRole.User)))
    ).resolves.toBe(true)
    await expect(
      guard.canActivate(context(evidence(SystemRole.User, SystemRole.SuperAdmin)))
    ).rejects.toThrow(ForbiddenException)
  })

  it('allows distinct original and current roles when both belong to the exact required set', async () => {
    getAllAndOverride.mockReturnValue([SystemRole.User, SystemRole.SuperAdmin])
    await expect(
      guard.canActivate(context(evidence(SystemRole.User, SystemRole.SuperAdmin)))
    ).resolves.toBe(true)
    await expect(
      guard.canActivate(context(evidence(SystemRole.SuperAdmin, SystemRole.User)))
    ).resolves.toBe(true)
  })

  it('requires the same effective principal, not evidence from another request', async () => {
    getAllAndOverride.mockReturnValue([SystemRole.SuperAdmin])
    await expect(
      guard.canActivate(
        context(evidence(SystemRole.SuperAdmin, SystemRole.SuperAdmin), {
          type: 'jwt',
          sub: 'other',
          systemRole: SystemRole.SuperAdmin,
        })
      )
    ).rejects.toThrow(ForbiddenException)
  })
})
