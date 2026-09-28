import { JwtService } from '@nestjs/jwt'

import { SystemRole } from '@amcore/shared'

import { UnauthorizedException } from '../../common/exceptions'
import type { EnvService } from '../../env/env.service'

import { TokenService } from './token.service'

const payload = {
  sub: 'actor',
  email: 'actor@example.test',
  systemRole: SystemRole.User,
  sid: 'session',
}
const epoch = 2000000000

describe('Actual derived JWT signatures', () => {
  const jwt = new JwtService({
    secret: 'derived-signature-test-only-secret',
    signOptions: { expiresIn: 900 },
  })
  const tokens = new TokenService(jwt, {} as EnvService)
  beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(epoch * 1000))
  afterEach(() => jest.restoreAllMocks())

  it('overrides the normal lifetime and preserves expiry through recursive exchanges', () => {
    let exp = epoch + 5
    for (const organizationId of ['A', 'B', 'A']) {
      const signed = tokens.generateDerivedAccessToken({ ...payload, organizationId }, exp)
      const verified = jwt.verify(signed) as typeof payload & {
        exp: number
        iat: number
        organizationId: string
      }
      expect(verified).toMatchObject({ ...payload, organizationId, exp: epoch + 5, iat: epoch })
      exp = verified.exp
    }
    expect(jwt.verify(tokens.generateAccessToken(payload)).exp).toBe(epoch + 900)
  })

  it('uses captured iat even if signing crosses a wall-clock second', () => {
    jest
      .spyOn(Date, 'now')
      .mockReturnValueOnce(epoch * 1000 + 999)
      .mockReturnValue((epoch + 1) * 1000)
    const signed = tokens.generateDerivedAccessToken(payload, epoch + 2)
    expect(jwt.verify(signed)).toMatchObject({ exp: epoch + 2, iat: epoch })
  })

  it.each([undefined, NaN, Infinity, epoch, epoch - 1, epoch + 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid or elapsed parent expiry %s without signing',
    (exp) => {
      const sign = jest.spyOn(jwt, 'sign')
      expect(() => tokens.generateDerivedAccessToken(payload, exp)).toThrow(UnauthorizedException)
      expect(sign).not.toHaveBeenCalled()
    }
  )
})
