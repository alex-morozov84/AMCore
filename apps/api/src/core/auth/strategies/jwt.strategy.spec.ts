import { SystemRole } from '@amcore/shared'

import { UnauthorizedException } from '../../../common/exceptions'
import type { EnvService } from '../../../env/env.service'
import type { PrivilegedRoleService } from '../privileged-role.service'
import type { UserCacheService } from '../user-cache.service'

import { JwtStrategy } from './jwt.strategy'

describe('JwtStrategy', () => {
  let strategy: JwtStrategy
  let getUser: jest.Mock
  let getCurrentSystemRole: jest.Mock

  beforeEach(() => {
    getUser = jest.fn()
    getCurrentSystemRole = jest.fn().mockResolvedValue(SystemRole.SuperAdmin)
    const env = {
      get: jest.fn().mockReturnValue('test-secret-key-minimum-32-characters-xx'),
    } as unknown as EnvService
    strategy = new JwtStrategy(
      env,
      { getUser } as unknown as UserCacheService,
      { getCurrentSystemRole } as unknown as PrivilegedRoleService
    )
  })

  it('carries sid from the payload into the principal (OB-06b)', async () => {
    getUser.mockResolvedValue({ id: 'user-1' })

    const principal = await strategy.validate({
      sub: 'user-1',
      email: 'a@example.com',
      systemRole: SystemRole.SuperAdmin,
      sid: 'session-1',
    })

    expect(principal).toMatchObject({ type: 'jwt', sub: 'user-1', sid: 'session-1' })
    expect(getUser).not.toHaveBeenCalled()
    expect(getCurrentSystemRole).toHaveBeenCalledWith('user-1')
  })

  it('leaves sid undefined for a legacy token without the claim', async () => {
    getUser.mockResolvedValue({ id: 'user-1' })

    const principal = await strategy.validate({
      sub: 'user-1',
      email: 'a@example.com',
      systemRole: SystemRole.User,
    })

    expect(principal.sid).toBeUndefined()
  })

  it('carries the exp claim into the principal for SSE stream bounding (ADR-053)', async () => {
    getUser.mockResolvedValue({ id: 'user-1' })

    const principal = await strategy.validate({
      sub: 'user-1',
      email: 'a@example.com',
      systemRole: SystemRole.User,
      exp: 1_900_000_000,
    })

    expect(principal.exp).toBe(1_900_000_000)
  })

  it('leaves exp undefined when the token lacks the claim', async () => {
    getUser.mockResolvedValue({ id: 'user-1' })

    const principal = await strategy.validate({
      sub: 'user-1',
      email: 'a@example.com',
      systemRole: SystemRole.User,
    })

    expect(principal.exp).toBeUndefined()
  })

  it('rejects when the user no longer exists', async () => {
    getUser.mockResolvedValue(null)

    await expect(
      strategy.validate({ sub: 'gone', email: 'a@example.com', systemRole: SystemRole.User })
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('propagates primary outage instead of authorizing through cache', async () => {
    getCurrentSystemRole.mockRejectedValue(new Error('primary unavailable'))
    getUser.mockResolvedValue({ id: 'user-1' })
    await expect(
      strategy.validate({
        sub: 'user-1',
        email: 'a@example.com',
        systemRole: SystemRole.SuperAdmin,
      })
    ).rejects.toThrow('primary unavailable')
    expect(getUser).not.toHaveBeenCalled()
  })

  it('rejects a deleted privileged account and retains the signed role after demotion', async () => {
    getCurrentSystemRole.mockResolvedValueOnce(null).mockResolvedValueOnce(SystemRole.User)
    const signed = { sub: 'user-1', email: 'a@example.com', systemRole: SystemRole.SuperAdmin }
    await expect(strategy.validate(signed)).rejects.toBeInstanceOf(UnauthorizedException)
    expect((await strategy.validate(signed)).systemRole).toBe(SystemRole.SuperAdmin)
    // The separate primary admission intersects this original claim before a privileged grant.
    expect(getUser).not.toHaveBeenCalled()
  })
})
