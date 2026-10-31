import { SystemRole } from '@amcore/shared'

import { UnauthorizedException } from '../../../common/exceptions'
import type { EnvService } from '../../../env/env.service'
import { beginJwtPrimaryAdmission, takeJwtPrimaryProjection } from '../mfa/jwt-primary-admission.js'
import type { MfaAuthorityReader } from '../mfa/mfa-authority-reader.service.js'
import type { PrivilegedRoleService } from '../privileged-role.service'

import { JwtStrategy } from './jwt.strategy'

describe('JwtStrategy', () => {
  let strategy: JwtStrategy
  let readPrimaryProjection: jest.Mock
  let getCurrentSystemRole: jest.Mock

  beforeEach(() => {
    readPrimaryProjection = jest.fn()
    getCurrentSystemRole = jest.fn().mockResolvedValue(SystemRole.SuperAdmin)
    const env = {
      get: jest.fn().mockReturnValue('test-secret-key-minimum-32-characters-xx'),
    } as unknown as EnvService
    strategy = new JwtStrategy(
      env,
      { getCurrentSystemRole } as unknown as PrivilegedRoleService,
      { readPrimaryProjection } as unknown as MfaAuthorityReader
    )
  })

  describe('standalone validation (no enclosing admission)', () => {
    it('carries sid from the payload into the principal (OB-06b)', async () => {
      const principal = await strategy.validate({
        sub: 'user-1',
        email: 'a@example.com',
        systemRole: SystemRole.SuperAdmin,
        sid: 'session-1',
      })

      expect(principal).toMatchObject({ type: 'jwt', sub: 'user-1', sid: 'session-1' })
      expect(getCurrentSystemRole).toHaveBeenCalledWith('user-1')
    })

    it('retains family and browser claims and reads existence from primary for a USER claim', async () => {
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
      expect(getCurrentSystemRole).toHaveBeenCalledWith('user-1')
    })

    it('reads existence from primary for an ordinary token (no user cache)', async () => {
      getCurrentSystemRole.mockResolvedValue(SystemRole.User)
      await strategy.validate({
        sub: 'user-1',
        email: 'a@example.com',
        systemRole: SystemRole.User,
      })
      expect(getCurrentSystemRole).toHaveBeenCalledTimes(1)
      expect(getCurrentSystemRole).toHaveBeenCalledWith('user-1')
    })

    it('leaves sid undefined for a legacy token without the claim', async () => {
      const principal = await strategy.validate({
        sub: 'user-1',
        email: 'a@example.com',
        systemRole: SystemRole.User,
      })

      expect(principal.sid).toBeUndefined()
    })

    it('carries the exp claim into the principal for SSE stream bounding (ADR-053)', async () => {
      const principal = await strategy.validate({
        sub: 'user-1',
        email: 'a@example.com',
        systemRole: SystemRole.User,
        exp: 1_900_000_000,
      })

      expect(principal.exp).toBe(1_900_000_000)
    })

    it('leaves exp undefined when the token lacks the claim', async () => {
      const principal = await strategy.validate({
        sub: 'user-1',
        email: 'a@example.com',
        systemRole: SystemRole.User,
      })

      expect(principal.exp).toBeUndefined()
    })

    it('rejects when the user no longer exists', async () => {
      getCurrentSystemRole.mockResolvedValue(null)

      await expect(
        strategy.validate({ sub: 'gone', email: 'a@example.com', systemRole: SystemRole.User })
      ).rejects.toBeInstanceOf(UnauthorizedException)
    })

    it('propagates primary outage instead of authorizing', async () => {
      getCurrentSystemRole.mockRejectedValue(new Error('primary unavailable'))
      await expect(
        strategy.validate({
          sub: 'user-1',
          email: 'a@example.com',
          systemRole: SystemRole.SuperAdmin,
        })
      ).rejects.toThrow('primary unavailable')
    })

    it('rejects a deleted privileged account and retains the signed role after demotion', async () => {
      getCurrentSystemRole.mockResolvedValueOnce(null).mockResolvedValueOnce(SystemRole.User)
      const signed = { sub: 'user-1', email: 'a@example.com', systemRole: SystemRole.SuperAdmin }
      await expect(strategy.validate(signed)).rejects.toBeInstanceOf(UnauthorizedException)
      expect((await strategy.validate(signed)).systemRole).toBe(SystemRole.SuperAdmin)
      // The separate primary admission intersects this original claim before a privileged grant.
    })
  })

  describe('inside the global guard admission', () => {
    const tokens = {
      ordinary: { sub: 'user-1', email: 'a@example.com', systemRole: SystemRole.User },
      family: {
        sub: 'user-1',
        email: 'a@example.com',
        systemRole: SystemRole.User,
        fid: 'family',
        securityVersion: 1,
      },
      browserBound: {
        sub: 'user-1',
        email: 'a@example.com',
        systemRole: SystemRole.User,
        browserBound: true as const,
      },
      superAdmin: { sub: 'user-1', email: 'a@example.com', systemRole: SystemRole.SuperAdmin },
    }

    it.each(Object.entries(tokens))(
      'reads one primary projection and retains it for a %s token',
      async (_name, claims) => {
        const request = {}
        const projection = { user: { id: 'user-1' } }
        readPrimaryProjection.mockResolvedValueOnce(projection)
        const release = beginJwtPrimaryAdmission(request)
        try {
          const principal = await strategy.validate(request, claims)
          expect(readPrimaryProjection).toHaveBeenCalledTimes(1)
          expect(getCurrentSystemRole).not.toHaveBeenCalled()
          expect(takeJwtPrimaryProjection(request, principal)).toBe(projection)
          // Consumed once: a second take for the same principal finds nothing.
          expect(takeJwtPrimaryProjection(request, principal)).toBeNull()
        } finally {
          release()
        }
      }
    )

    it('rejects a deleted user with 401 before any other read', async () => {
      const request = {}
      readPrimaryProjection.mockResolvedValueOnce(null)
      const release = beginJwtPrimaryAdmission(request)
      try {
        await expect(strategy.validate(request, tokens.ordinary)).rejects.toBeInstanceOf(
          UnauthorizedException
        )
      } finally {
        release()
      }
      expect(getCurrentSystemRole).not.toHaveBeenCalled()
    })

    it('propagates a primary outage from the projection read', async () => {
      const request = {}
      readPrimaryProjection.mockRejectedValueOnce(new Error('primary unavailable'))
      const release = beginJwtPrimaryAdmission(request)
      try {
        await expect(strategy.validate(request, tokens.ordinary)).rejects.toThrow(
          'primary unavailable'
        )
      } finally {
        release()
      }
    })

    it('falls back to the standalone primary read once the enclosing admission has ended', async () => {
      const request = {}
      const release = beginJwtPrimaryAdmission(request)
      release()
      getCurrentSystemRole.mockResolvedValue(SystemRole.User)
      await strategy.validate(request, tokens.ordinary)
      expect(readPrimaryProjection).not.toHaveBeenCalled()
      expect(getCurrentSystemRole).toHaveBeenCalledTimes(1)
    })
  })
})
