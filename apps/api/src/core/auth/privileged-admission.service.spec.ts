import { type RequestPrincipal, SystemRole } from '@amcore/shared'

import { UnauthorizedException } from '../../common/exceptions'

import { PrivilegedAdmissionService } from './privileged-admission.service'
import { PrivilegedRoleService } from './privileged-role.service'

const jwt = (systemRole: SystemRole = SystemRole.SuperAdmin): RequestPrincipal => ({
  type: 'jwt',
  sub: 'actor',
  systemRole,
  sid: 'session',
  exp: 2000000000,
})

describe('PrivilegedAdmissionService', () => {
  const getCurrentSystemRole = jest.fn()
  const service = new PrivilegedAdmissionService({
    getCurrentSystemRole,
  } as unknown as PrivilegedRoleService)
  beforeEach(() => getCurrentSystemRole.mockReset())

  it('demotes every stale privileged claim while preserving immutable credential facts', async () => {
    getCurrentSystemRole.mockResolvedValue(SystemRole.User)
    const original = jwt()
    const admission = await service.resolve(original)
    expect(admission.principal).toEqual({ ...original, systemRole: SystemRole.User })
    expect(admission.authenticated.systemRole).toBe(SystemRole.SuperAdmin)
    expect(original.systemRole).toBe(SystemRole.SuperAdmin)
    expect(Object.isFrozen(admission.authenticated)).toBe(true)
    expect(getCurrentSystemRole).toHaveBeenCalledTimes(1)
  })

  it('keeps live privilege and never elevates a USER token after promotion', async () => {
    getCurrentSystemRole.mockResolvedValue(SystemRole.SuperAdmin)
    expect((await service.resolve(jwt())).principal.systemRole).toBe(SystemRole.SuperAdmin)
    expect((await service.resolve(jwt(SystemRole.User))).principal.systemRole).toBe(SystemRole.User)
    expect(getCurrentSystemRole).toHaveBeenCalledTimes(1)
  })

  it('reads authority once for an exact USER metadata requirement without promoting', async () => {
    getCurrentSystemRole.mockResolvedValue(SystemRole.SuperAdmin)
    const result = await service.resolve(jwt(SystemRole.User), [SystemRole.User])
    expect(result.currentRole).toBe(SystemRole.SuperAdmin)
    expect(result.principal.systemRole).toBe(SystemRole.User)
  })

  it('projects every API key to USER without consulting owner role as a grant', async () => {
    const key: RequestPrincipal = {
      ...jwt(),
      type: 'api_key',
      scopes: ['read:User'],
      organizationId: 'org',
      aclVersion: 2,
    }
    const result = await service.resolve(key, [SystemRole.SuperAdmin])
    expect(result.currentRole).toBe(SystemRole.User)
    expect(result.principal.systemRole).toBe(SystemRole.User)
    expect(result.principal.scopes).toEqual(['read:User'])
    expect(getCurrentSystemRole).not.toHaveBeenCalled()
    key.scopes!.push('manage:TeamAccess')
    expect(result.authenticated.scopes).toEqual(['read:User'])
  })

  it('fails closed for deletion or primary outage', async () => {
    getCurrentSystemRole.mockResolvedValue(null)
    await expect(service.resolve(jwt())).rejects.toThrow(UnauthorizedException)
    const outage = new Error('primary unavailable')
    getCurrentSystemRole.mockRejectedValue(outage)
    await expect(service.resolve(jwt())).rejects.toBe(outage)
  })
  it('reuses only evidence returned for the identical admitted principal and preserves role intersection', async () => {
    const privileged = jwt()
    expect(
      (
        await service.resolve(privileged, [], {
          principal: privileged,
          currentRole: SystemRole.User,
        })
      ).principal.systemRole
    ).toBe(SystemRole.User)
    const ordinary = jwt(SystemRole.User)
    expect(
      (
        await service.resolve(ordinary, [SystemRole.User], {
          principal: ordinary,
          currentRole: SystemRole.SuperAdmin,
        })
      ).principal.systemRole
    ).toBe(SystemRole.User)
    expect(getCurrentSystemRole).not.toHaveBeenCalled()
    getCurrentSystemRole.mockResolvedValue(SystemRole.User)
    await service.resolve(privileged, [], {
      principal: { ...privileged },
      currentRole: SystemRole.SuperAdmin,
    })
    expect(getCurrentSystemRole).toHaveBeenCalledTimes(1)
  })
})
