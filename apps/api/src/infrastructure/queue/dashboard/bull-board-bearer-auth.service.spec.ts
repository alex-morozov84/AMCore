import { JwtService } from '@nestjs/jwt'

import { SystemRole } from '@amcore/shared'

import { UnauthorizedException } from '../../../common/exceptions'
import { PrivilegedAdmissionService } from '../../../core/auth/privileged-admission.service'
import type { PrivilegedRoleService } from '../../../core/auth/privileged-role.service'

import { BullBoardBearerAuthService } from './bull-board-bearer-auth.service'

const SECRET = 'bearer-auth-spec-secret-at-least-32-characters'

describe('BullBoardBearerAuthService (admission of the Console BFF)', () => {
  const jwt = new JwtService({ secret: SECRET })
  const getCurrentSystemRole = jest.fn()
  const service = new BullBoardBearerAuthService(
    jwt,
    new PrivilegedAdmissionService({ getCurrentSystemRole } as unknown as PrivilegedRoleService)
  )

  const sign = (
    payload: Record<string, unknown>,
    options: Parameters<JwtService['sign']>[1] = {}
  ) =>
    jwt.sign(
      { sub: 'user-1', email: 'a@b.co', systemRole: SystemRole.SuperAdmin, ...payload },
      {
        expiresIn: '15m',
        ...options,
      }
    )

  beforeEach(() => getCurrentSystemRole.mockReset())

  it('admits a SUPER_ADMIN claim that the primary database still confirms', async () => {
    getCurrentSystemRole.mockResolvedValue(SystemRole.SuperAdmin)
    await expect(service.verify(sign({}))).resolves.toEqual({
      kind: 'authorized',
      userId: 'user-1',
    })
    expect(getCurrentSystemRole).toHaveBeenCalledWith('user-1')
  })

  it('refuses a demoted admin: the stale claim is demoted by admission, not thrown', async () => {
    getCurrentSystemRole.mockResolvedValue(SystemRole.User)
    await expect(service.verify(sign({}))).resolves.toEqual({ kind: 'forbidden' })
  })

  it('never lets the database grant SUPER_ADMIN to a USER claim', async () => {
    getCurrentSystemRole.mockResolvedValue(SystemRole.SuperAdmin)
    await expect(service.verify(sign({ systemRole: SystemRole.User }))).resolves.toEqual({
      kind: 'forbidden',
    })
    expect(getCurrentSystemRole).not.toHaveBeenCalled()
  })

  it('answers 401-class for a deleted user', async () => {
    getCurrentSystemRole.mockResolvedValue(null)
    await expect(service.verify(sign({}))).resolves.toEqual({ kind: 'unauthenticated' })
  })

  it('reports an infrastructure failure as unavailable, not as a denial', async () => {
    getCurrentSystemRole.mockRejectedValue(new Error('pool timeout'))
    await expect(service.verify(sign({}))).resolves.toEqual({ kind: 'unavailable' })
    getCurrentSystemRole.mockRejectedValue(new UnauthorizedException('x'))
    await expect(service.verify(sign({}))).resolves.toEqual({ kind: 'unauthenticated' })
  })

  it.each([
    ['garbage', 'not-a-jwt'],
    [
      'wrong secret',
      new JwtService({ secret: 'another-secret-another-secret-12345678' }).sign({
        sub: 'u',
        systemRole: 'SUPER_ADMIN',
      }),
    ],
    ['expired', sign({}, { expiresIn: '-1s' })],
    ['no subject', jwt.sign({ systemRole: SystemRole.SuperAdmin }, { expiresIn: '15m' })],
    ['empty subject', sign({ sub: '' })],
    [
      'none algorithm',
      `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from('{"sub":"u","systemRole":"SUPER_ADMIN"}').toString('base64url')}.`,
    ],
  ])('refuses %s without touching the database', async (_label, token) => {
    await expect(service.verify(token)).resolves.toEqual({ kind: 'unauthenticated' })
    expect(getCurrentSystemRole).not.toHaveBeenCalled()
  })

  it('refuses a token signed with a different HMAC algorithm', async () => {
    const token = jwt.sign(
      { sub: 'u', systemRole: SystemRole.SuperAdmin },
      { algorithm: 'HS512', expiresIn: '15m' }
    )
    await expect(service.verify(token)).resolves.toEqual({ kind: 'unauthenticated' })
  })
})
