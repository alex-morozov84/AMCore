import { SystemRole } from '@amcore/shared'

import { UnauthorizedException } from '../../../common/exceptions'
import type { EnvService } from '../../../env/env.service'
import { beginJwtPrimaryAdmission } from '../mfa/jwt-primary-admission.js'
import type { MfaAuthorityReader } from '../mfa/mfa-authority-reader.service.js'
import type { PrivilegedRoleService } from '../privileged-role.service'
import type { UserCacheService } from '../user-cache.service'

import { JwtStrategy } from './jwt.strategy'

describe('JwtStrategy', () => {
  let strategy: JwtStrategy
  let readPrimaryProjection: jest.Mock
  let getUser: jest.Mock
  let getCurrentSystemRole: jest.Mock

  beforeEach(() => {
    readPrimaryProjection = jest.fn()
    getUser = jest.fn()
    getCurrentSystemRole = jest.fn().mockResolvedValue(SystemRole.SuperAdmin)
    const env = {
      get: jest.fn().mockReturnValue('test-secret-key-minimum-32-characters-xx'),
    } as unknown as EnvService
    strategy = new JwtStrategy(
      env,
      { getUser } as unknown as UserCacheService,
      { getCurrentSystemRole } as unknown as PrivilegedRoleService,
      { readPrimaryProjection } as unknown as MfaAuthorityReader
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

  it('retains family and browser claims and reads existence from primary even for a USER claim', async () => {
    getCurrentSystemRole.mockResolvedValue(SystemRole.User)
    const principal = await strategy.validate({
      sub: 'user-1',
      email: 'a@example.com',
      systemRole: SystemRole.User,
      fid: 'family',
      securityVersion: 4,
      browserBound: true,
    })
    expect(principal).toMatchObject({ fid: 'family', securityVersion: 4, browserBound: true })
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
  it('consolidates existence only for a marked request, still rejecting deletion before credential selection', async () => {
    const request = { headers: { 'x-skip-existence': 'true' } }
    const claims = { sub: 'gone', email: 'gone@example.test', systemRole: SystemRole.SuperAdmin }
    getCurrentSystemRole.mockResolvedValue(null)
    await expect(strategy.validate(request, claims)).rejects.toBeInstanceOf(UnauthorizedException)
    getCurrentSystemRole.mockClear()
    readPrimaryProjection.mockResolvedValueOnce({ user: { id: 'gone' } })
    const release = beginJwtPrimaryAdmission(request)
    try {
      expect(await strategy.validate(request, claims)).toMatchObject({ sub: 'gone' })
    } finally {
      release()
    }
    expect(getCurrentSystemRole).not.toHaveBeenCalled()
    expect(readPrimaryProjection).toHaveBeenCalledTimes(1)
    await expect(strategy.validate(request, claims)).rejects.toBeInstanceOf(UnauthorizedException)
    const finish = beginJwtPrimaryAdmission(request)
    readPrimaryProjection.mockResolvedValueOnce(null)
    try {
      await expect(strategy.validate(request, claims)).rejects.toBeInstanceOf(UnauthorizedException)
    } finally {
      finish()
    }
  })
})
