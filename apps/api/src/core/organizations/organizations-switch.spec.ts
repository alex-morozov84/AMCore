import { JwtService } from '@nestjs/jwt'

import { type RequestPrincipal, SystemRole } from '@amcore/shared'

import type { EnvService } from '../../env/env.service'
import { TokenService } from '../auth/token.service'

import { OrganizationsController } from './organizations.controller'
import type { OrganizationsService } from './organizations.service'

describe('Organization exchange retains exact signed session authority', () => {
  const jwt = new JwtService({
    secret: '<fake-org-exchange-secret-at-least-32>',
    signOptions: { expiresIn: 900 },
  })
  const getForSwitch = jest.fn()
  const controller = new OrganizationsController(
    { getForSwitch } as unknown as OrganizationsService,
    new TokenService(jwt, {} as EnvService)
  )
  beforeEach(() => getForSwitch.mockReset().mockResolvedValue({ aclVersion: 7 }))

  it.each([true, undefined])(
    'retains family/epoch/browser=%s through recursive exchanges',
    async (browserBound) => {
      let principal: RequestPrincipal = {
        type: 'jwt',
        sub: 'actor',
        email: 'actor@example.test',
        systemRole: SystemRole.User,
        sid: 'old-sid',
        fid: 'exact-F',
        securityVersion: 3,
        exp: Math.floor(Date.now() / 1000) + 60,
        ...(browserBound && { browserBound }),
      }
      const expiry = principal.exp
      for (const organizationId of ['A', 'B', 'A']) {
        const response = await controller.switchOrganization(organizationId, principal)
        const claims = jwt.verify(response.accessToken)
        expect(claims).toMatchObject({
          sub: 'actor',
          sid: 'old-sid',
          fid: 'exact-F',
          securityVersion: 3,
          exp: expiry,
          organizationId,
          aclVersion: 7,
        })
        expect(claims.browserBound).toBe(browserBound)
        expect(getForSwitch).toHaveBeenLastCalledWith(organizationId, 'actor')
        principal = { type: 'jwt', ...claims }
      }
    }
  )

  it('retains the untouched legacy token shape without inventing a family', async () => {
    const response = await controller.switchOrganization('A', {
      type: 'jwt',
      sub: 'legacy',
      systemRole: SystemRole.User,
      exp: Math.floor(Date.now() / 1000) + 60,
    })
    const claims = jwt.verify(response.accessToken)
    for (const field of ['fid', 'securityVersion', 'browserBound'])
      expect(claims[field]).toBeUndefined()
  })

  it('does not sign an exchange when membership fails', async () => {
    getForSwitch.mockRejectedValue(new Error('membership denied'))
    const sign = jest.spyOn(jwt, 'sign')
    await expect(
      controller.switchOrganization('A', {
        type: 'jwt',
        sub: 'actor',
        systemRole: SystemRole.User,
        exp: Math.floor(Date.now() / 1000) + 60,
      })
    ).rejects.toThrow('membership denied')
    expect(sign).not.toHaveBeenCalled()
    sign.mockRestore()
  })
})
