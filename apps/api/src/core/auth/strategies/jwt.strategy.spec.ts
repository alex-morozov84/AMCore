import { SystemRole } from '@amcore/shared'

import { UnauthorizedException } from '../../../common/exceptions'
import type { EnvService } from '../../../env/env.service'
import type { UserCacheService } from '../user-cache.service'

import { JwtStrategy } from './jwt.strategy'

describe('JwtStrategy', () => {
  let strategy: JwtStrategy
  let getUser: jest.Mock

  beforeEach(() => {
    getUser = jest.fn()
    const env = {
      get: jest.fn().mockReturnValue('test-secret-key-minimum-32-characters-xx'),
    } as unknown as EnvService
    strategy = new JwtStrategy(env, { getUser } as unknown as UserCacheService)
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

  it('rejects when the user no longer exists', async () => {
    getUser.mockResolvedValue(null)

    await expect(
      strategy.validate({ sub: 'gone', email: 'a@example.com', systemRole: SystemRole.User })
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })
})
