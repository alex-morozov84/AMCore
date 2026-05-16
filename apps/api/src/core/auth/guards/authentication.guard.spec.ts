import { HttpException, HttpStatus, type ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { AuthErrorCode } from '@amcore/shared'

import { AppException } from '../../../common/exceptions'
import { ApiKeyGuard } from '../../api-keys/guards/api-key.guard'
import { AbilityFactory } from '../casl/ability.factory'

import { AuthenticationGuard } from './authentication.guard'
import { JwtAuthGuard } from './jwt-auth.guard'
import { PoliciesGuard } from './policies.guard'
import { SystemRolesGuard } from './system-roles.guard'

// AK-07 regression — AppException(429) thrown by ApiKeyGuard.canActivate
// must propagate through AuthenticationGuard, not be swallowed into 401.
//
// The JWT branch deliberately catches everything (so a stale JWT falls
// through to the api-key attempt); the api-key branch deliberately
// does NOT catch (per AK-11 framing). This test locks that asymmetry
// in place so AK-11 work later can't accidentally re-symmetrize the
// chain and swallow the limiter's 429.

describe('AuthenticationGuard (AK-07 regression)', () => {
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
      // because the test throws inside the auth-chain stage (step 3).
      {} as unknown as AbilityFactory,
      {} as unknown as SystemRolesGuard,
      {} as unknown as PoliciesGuard
    )
  })

  it('propagates AppException(429) from ApiKeyGuard without swallowing to 401', async () => {
    // JWT fails (no token) — auth chain moves to ApiKey.
    jwtAuthGuard.canActivate.mockResolvedValue(false)
    apiKeyGuard.canActivate.mockRejectedValueOnce(
      new AppException(
        'Too many failed API key attempts. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
        AuthErrorCode.RATE_LIMIT_EXCEEDED,
        { retryAfterSeconds: 3600 }
      )
    )

    try {
      await guard.canActivate(createContext())
      fail('expected throw')
    } catch (e) {
      expect(e).toBeInstanceOf(AppException)
      const exc = e as AppException
      expect(exc.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS)
      expect(exc.errorCode).toBe(AuthErrorCode.RATE_LIMIT_EXCEEDED)
    }
  })

  // Defensive: JWT branch must still swallow its own errors so a stale
  // JWT can fall through to ApiKey auth. If a future refactor adds a
  // catch around the ApiKey branch, this test will fail in pair with
  // the propagation test above.
  it('still swallows JWT auth errors (chain continues to ApiKey)', async () => {
    jwtAuthGuard.canActivate.mockRejectedValueOnce(new HttpException('expired', 401))
    apiKeyGuard.canActivate.mockResolvedValue(false) // also fails → final 401

    await expect(guard.canActivate(createContext())).rejects.toMatchObject({
      message: 'Unauthorized',
    })

    expect(apiKeyGuard.canActivate).toHaveBeenCalledTimes(1)
  })
})
