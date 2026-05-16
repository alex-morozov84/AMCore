import { type ExecutionContext, HttpException, HttpStatus } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { AuthErrorCode } from '@amcore/shared'

import { AppException } from '../../../common/exceptions'
import { ApiKeyGuard } from '../../api-keys/guards/api-key.guard'
import { AbilityFactory } from '../casl/ability.factory'

import { AuthenticationGuard } from './authentication.guard'
import { JwtAuthGuard } from './jwt-auth.guard'
import { PoliciesGuard } from './policies.guard'
import { SystemRolesGuard } from './system-roles.guard'

// Raw NestJS exception subclasses (ForbiddenException, etc.) are banned
// in src/** per the PR 7 / cross-cutting review rule. For tests that need
// to simulate guards throwing specific HTTP statuses, construct
// HttpException with HttpStatus directly — the discriminator under test
// keys on `getStatus()`, not on the concrete class.

// AK-11 contract: the auth chain swallows decision-class failures
// (401/403) and propagates infrastructure failures. This file pins the
// policy via concrete cases — JWT 401 swallowed (stale token → try
// ApiKey), JWT 500 propagates (Redis lookup failure surfaces, not masked
// as 401), ApiKey 429 propagates (AK-07 rate-limit), ApiKey generic Error
// propagates, ApiKey 403 swallowed for symmetry. The Stage 8 regression
// for 429 propagation is preserved verbatim — it's the canonical
// "infra propagates" test and must stay green after the AK-11 refactor
// unified both branches under one discriminating catch.

describe('AuthenticationGuard', () => {
  let guard: AuthenticationGuard
  let reflector: jest.Mocked<Pick<Reflector, 'getAllAndOverride'>>
  let jwtAuthGuard: jest.Mocked<Pick<JwtAuthGuard, 'canActivate'>>
  let apiKeyGuard: jest.Mocked<Pick<ApiKeyGuard, 'canActivate'>>

  const createContext = (): ExecutionContext =>
    ({
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({
        getRequest: () => ({ user: undefined, headers: {} }),
      }),
    }) as unknown as ExecutionContext

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() } as unknown as jest.Mocked<
      Pick<Reflector, 'getAllAndOverride'>
    >
    jwtAuthGuard = { canActivate: jest.fn() } as unknown as jest.Mocked<
      Pick<JwtAuthGuard, 'canActivate'>
    >
    apiKeyGuard = { canActivate: jest.fn() } as unknown as jest.Mocked<
      Pick<ApiKeyGuard, 'canActivate'>
    >

    // Default: no @Auth() decorator → falls through to [Bearer, ApiKey] default.
    reflector.getAllAndOverride.mockReturnValue(undefined)

    guard = new AuthenticationGuard(
      reflector as unknown as Reflector,
      jwtAuthGuard as unknown as JwtAuthGuard,
      apiKeyGuard as unknown as ApiKeyGuard,
      // AbilityFactory / SystemRolesGuard / PoliciesGuard are not exercised
      // because every test below either succeeds or throws inside step 3
      // (the auth chain), before the authz stage runs.
      {} as unknown as AbilityFactory,
      {} as unknown as SystemRolesGuard,
      {} as unknown as PoliciesGuard
    )
  })

  describe('AK-11: decision-class failures swallowed, infra propagates', () => {
    it('JWT throws UnauthorizedException → swallowed, chain falls through to ApiKey', async () => {
      jwtAuthGuard.canActivate.mockRejectedValueOnce(new HttpException('expired', 401))
      apiKeyGuard.canActivate.mockResolvedValue(false)

      await expect(guard.canActivate(createContext())).rejects.toMatchObject({
        message: 'Unauthorized',
      })

      expect(apiKeyGuard.canActivate).toHaveBeenCalledTimes(1)
    })

    it('JWT throws HttpException(403) → swallowed, chain falls through to ApiKey', async () => {
      jwtAuthGuard.canActivate.mockRejectedValueOnce(
        new HttpException('blocked', HttpStatus.FORBIDDEN)
      )
      apiKeyGuard.canActivate.mockResolvedValue(false)

      await expect(guard.canActivate(createContext())).rejects.toMatchObject({
        message: 'Unauthorized',
      })

      expect(apiKeyGuard.canActivate).toHaveBeenCalledTimes(1)
    })

    it('JWT throws HttpException(500) → propagates, ApiKey not tried', async () => {
      // Models a Redis outage during JwtStrategy.validate() user lookup.
      // Pre-AK-11 this was masked as 401; the new policy surfaces it.
      jwtAuthGuard.canActivate.mockRejectedValueOnce(
        new HttpException('Redis connection refused', HttpStatus.INTERNAL_SERVER_ERROR)
      )
      apiKeyGuard.canActivate.mockResolvedValue(false)

      await expect(guard.canActivate(createContext())).rejects.toMatchObject({
        message: 'Redis connection refused',
      })

      expect(apiKeyGuard.canActivate).not.toHaveBeenCalled()
    })

    it('JWT throws generic Error → propagates, ApiKey not tried', async () => {
      // Non-HttpException — definitely not decision-class.
      jwtAuthGuard.canActivate.mockRejectedValueOnce(new Error('unexpected'))
      apiKeyGuard.canActivate.mockResolvedValue(false)

      await expect(guard.canActivate(createContext())).rejects.toThrow('unexpected')

      expect(apiKeyGuard.canActivate).not.toHaveBeenCalled()
    })

    // Stage 8 regression kept (refactored away from try/catch+fail to
    // satisfy jest/no-conditional-expect after AK-11). Both branches now
    // share the discriminating catch; this test guarantees 429 (the
    // AK-07 rate-limit signal) still escapes the chain unchanged.
    it('ApiKey throws AppException(429) → propagates (AK-07 regression)', async () => {
      jwtAuthGuard.canActivate.mockResolvedValue(false)
      apiKeyGuard.canActivate.mockRejectedValueOnce(
        new AppException(
          'Too many failed API key attempts. Please try again later.',
          HttpStatus.TOO_MANY_REQUESTS,
          AuthErrorCode.RATE_LIMIT_EXCEEDED,
          { retryAfterSeconds: 3600 }
        )
      )

      const err = await guard.canActivate(createContext()).catch((e: unknown) => e)

      expect(err).toBeInstanceOf(AppException)
      expect((err as AppException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS)
      expect((err as AppException).errorCode).toBe(AuthErrorCode.RATE_LIMIT_EXCEEDED)
    })

    it('ApiKey throws generic Error → propagates (e.g. Redis dependency lost)', async () => {
      jwtAuthGuard.canActivate.mockResolvedValue(false)
      apiKeyGuard.canActivate.mockRejectedValueOnce(new Error('Redis ECONNRESET'))

      await expect(guard.canActivate(createContext())).rejects.toThrow('Redis ECONNRESET')
    })

    it('ApiKey throws HttpException(403) → swallowed, final result is 401', async () => {
      // ApiKeyGuard returns false on decision today, but for symmetry the
      // chain must also tolerate a thrown 403 from any future auth strategy.
      jwtAuthGuard.canActivate.mockResolvedValue(false)
      apiKeyGuard.canActivate.mockRejectedValueOnce(
        new HttpException('blocked', HttpStatus.FORBIDDEN)
      )

      await expect(guard.canActivate(createContext())).rejects.toMatchObject({
        message: 'Unauthorized',
      })
    })
  })
})
