import { Controller, type ExecutionContext, Get, HttpException, HttpStatus } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ClientClosedError } from '@redis/client'

import { AuthErrorCode, AuthType } from '@amcore/shared'

import { AppException } from '../../../common/exceptions'
import { ApiKeyGuard } from '../../api-keys/guards/api-key.guard'
import type { BrowserSessionContextService } from '../../frontend-context/browser-session-context.service'
import { AbilityFactory } from '../casl/ability.factory'
import { MfaJwtAdmissionService } from '../mfa/mfa-jwt-admission.service.js'
import { OrganizationContextResolver } from '../organization-context/organization-context-resolver.service'
import {
  OrganizationContextBoundary,
  RequestContextPolicy,
} from '../organization-context/request-context-policy'
import { PrivilegedAdmissionService } from '../privileged-admission.service'
import { AUTH_STAGE_MS, AuthStageService } from '../stage/auth-stage.service.js'

import { AuthenticationGuard } from './authentication.guard'
import { JwtAuthGuard } from './jwt-auth.guard'
import { PoliciesGuard } from './policies.guard'
import { SystemRolesGuard } from './system-roles.guard'
import { TeamAccessGuard } from './team-access.guard'

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

@Controller('public-context-fixture')
@OrganizationContextBoundary({ apiRoots: ['/api/v1/public-context-fixture'] })
class PublicContextFixture {
  @Get('missing')
  missing() {
    return undefined
  }

  @Get(':id')
  @RequestContextPolicy({ kind: 'organization', selector: { param: 'id' } })
  selected() {
    return undefined
  }
}

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

    // AK-11 tests below validate chain behavior when both auth types are
    // active — that is the only scenario where decision/infra swallow vs
    // propagate matters. Post-ADR-034 this state is reached only via an
    // explicit `@Auth(AuthType.Bearer, AuthType.ApiKey)` annotation (the
    // runtime fallback for undecorated routes is `[AuthType.Bearer]`).
    // The default-fallback behavior itself is asserted in the separate
    // "ADR-034 default" describe block below.
    reflector.getAllAndOverride.mockReturnValue([AuthType.Bearer, AuthType.ApiKey])

    guard = new AuthenticationGuard(
      reflector as unknown as Reflector,
      jwtAuthGuard as unknown as JwtAuthGuard,
      apiKeyGuard as unknown as ApiKeyGuard,
      // AbilityFactory / SystemRolesGuard / PoliciesGuard are not exercised
      // because every test below either succeeds or throws inside step 3
      // (the auth chain), before the authz stage runs.
      {} as unknown as AbilityFactory,
      { requiredRoles: () => [] } as unknown as SystemRolesGuard,
      {} as unknown as PoliciesGuard,
      { canActivate: jest.fn().mockResolvedValue(true) } as unknown as TeamAccessGuard,
      {
        resolve: async (principal: any) => ({ principal, authenticated: principal }),
      } as unknown as PrivilegedAdmissionService,
      {
        resolve: async (_context: unknown, admission: unknown) => ({ admission }),
      } as unknown as OrganizationContextResolver,
      { assert: async () => undefined } as unknown as MfaJwtAdmissionService,
      { verify: () => undefined } as unknown as BrowserSessionContextService,
      new AuthStageService()
    )
  })

  it.each(['missing', 'selected'] as const)(
    'does not let public auth bypass scoped %s admission',
    async (method) => {
      reflector.getAllAndOverride.mockReturnValue([AuthType.None])
      const context = {
        ...createContext(),
        getHandler: () => PublicContextFixture.prototype[method],
        getClass: () => PublicContextFixture,
      } as unknown as ExecutionContext
      await expect(guard.canActivate(context)).rejects.toThrow()
      expect(jwtAuthGuard.canActivate).not.toHaveBeenCalled()
      expect(apiKeyGuard.canActivate).not.toHaveBeenCalled()
    }
  )

  it('propagates authority lookup failure without attaching ability or running policies', async () => {
    const failure = new Error('primary unavailable')
    const createAuthorizationContext = jest.fn().mockRejectedValue(failure)
    const policies = { canActivate: jest.fn() }
    const request = { user: { sub: 'actor' }, ability: undefined }
    const context = {
      ...createContext(),
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext
    jwtAuthGuard.canActivate.mockResolvedValue(true)
    const candidate = new AuthenticationGuard(
      reflector as unknown as Reflector,
      jwtAuthGuard as unknown as JwtAuthGuard,
      apiKeyGuard as unknown as ApiKeyGuard,
      { createAuthorizationContext } as unknown as AbilityFactory,
      { requiredRoles: () => [], canActivate: jest.fn() } as unknown as SystemRolesGuard,
      policies as unknown as PoliciesGuard,
      { canActivate: jest.fn().mockResolvedValue(true) } as unknown as TeamAccessGuard,
      {
        resolve: async (principal: any) => ({ principal, authenticated: principal }),
      } as unknown as PrivilegedAdmissionService,
      {
        resolve: async (_context: unknown, admission: unknown) => ({ admission }),
      } as unknown as OrganizationContextResolver,
      { assert: async () => undefined } as unknown as MfaJwtAdmissionService,
      { verify: () => undefined } as unknown as BrowserSessionContextService,
      new AuthStageService()
    )
    await expect(candidate.canActivate(context)).rejects.toBe(failure)
    expect(request.ability).toBeUndefined()
    expect(policies.canActivate).not.toHaveBeenCalled()
    expect(apiKeyGuard.canActivate).not.toHaveBeenCalled()
  })

  it('propagates terminal MFA denial before privileges/ability without API-key fallback', async () => {
    const denied = new AppException('Session authority changed', 409, AuthErrorCode.SESSION_CHANGED)
    const request = { user: { type: 'jwt', sub: 'actor' }, ability: undefined }
    const context = {
      ...createContext(),
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext
    jwtAuthGuard.canActivate.mockResolvedValue(true)
    const resolve = jest.fn()
    const createAuthorizationContext = jest.fn()
    const candidate = new AuthenticationGuard(
      reflector as unknown as Reflector,
      jwtAuthGuard as unknown as JwtAuthGuard,
      apiKeyGuard as unknown as ApiKeyGuard,
      { createAuthorizationContext } as unknown as AbilityFactory,
      { requiredRoles: () => [] } as unknown as SystemRolesGuard,
      {} as unknown as PoliciesGuard,
      {} as unknown as TeamAccessGuard,
      { resolve } as unknown as PrivilegedAdmissionService,
      {} as unknown as OrganizationContextResolver,
      {
        assert: async () => {
          throw denied
        },
      } as unknown as MfaJwtAdmissionService,
      { verify: () => undefined } as unknown as BrowserSessionContextService,
      new AuthStageService()
    )
    await expect(candidate.canActivate(context)).rejects.toBe(denied)
    expect(apiKeyGuard.canActivate).not.toHaveBeenCalled()
    expect(resolve).not.toHaveBeenCalled()
    expect(createAuthorizationContext).not.toHaveBeenCalled()
    expect(request.ability).toBeUndefined()
  })

  it('TeamAccess authorization denial never retries a second credential', async () => {
    const request = { user: { sub: 'actor' }, ability: undefined, teamAccess: undefined }
    const ctx = {
      ...createContext(),
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext
    const denied = new HttpException('TeamAccess denied', HttpStatus.FORBIDDEN)
    const keyGuard = { canActivate: jest.fn() }
    const contextFactory = {
      createAuthorizationContext: jest.fn().mockResolvedValue({ ability: {}, teamAccess: {} }),
    }
    const candidate = new AuthenticationGuard(
      reflector as unknown as Reflector,
      { canActivate: jest.fn().mockResolvedValue(true) } as unknown as JwtAuthGuard,
      keyGuard as unknown as ApiKeyGuard,
      contextFactory as unknown as AbilityFactory,
      {
        requiredRoles: () => [],
        canActivate: jest.fn().mockResolvedValue(true),
      } as unknown as SystemRolesGuard,
      { canActivate: jest.fn().mockResolvedValue(true) } as unknown as PoliciesGuard,
      { canActivate: jest.fn().mockRejectedValue(denied) } as unknown as TeamAccessGuard,
      {
        resolve: async (principal: any) => ({ principal, authenticated: principal }),
      } as unknown as PrivilegedAdmissionService,
      {
        resolve: async (_context: unknown, admission: unknown) => ({ admission }),
      } as unknown as OrganizationContextResolver,
      { assert: async () => undefined } as unknown as MfaJwtAdmissionService,
      { verify: () => undefined } as unknown as BrowserSessionContextService,
      new AuthStageService()
    )
    await expect(candidate.canActivate(ctx)).rejects.toBe(denied)
    expect(contextFactory.createAuthorizationContext).toHaveBeenCalledTimes(1)
    expect(keyGuard.canActivate).not.toHaveBeenCalled()
  })

  describe('admission budget (T082)', () => {
    afterEach(() => jest.useRealTimers())

    const status = async (promise: Promise<unknown>): Promise<unknown> =>
      promise.then(
        () => 'resolved',
        (error: unknown) =>
          error instanceof HttpException
            ? { status: error.getStatus(), body: error.getResponse() }
            : error
      )

    it('answers 503 SERVICE_UNAVAILABLE when credential selection outlives the stage', async () => {
      jest.useFakeTimers()
      jwtAuthGuard.canActivate.mockReturnValue(new Promise<boolean>(() => undefined))
      const outcome = status(guard.canActivate(createContext()))
      await jest.advanceTimersByTimeAsync(AUTH_STAGE_MS + 1)
      await expect(outcome).resolves.toMatchObject({
        status: 503,
        body: expect.objectContaining({ errorCode: 'SERVICE_UNAVAILABLE' }),
      })
      expect(apiKeyGuard.canActivate).not.toHaveBeenCalled()
    })

    it('maps a Redis outage during credential selection to 503, not a decision or 500', async () => {
      jwtAuthGuard.canActivate.mockRejectedValueOnce(new ClientClosedError())
      await expect(status(guard.canActivate(createContext()))).resolves.toMatchObject({
        status: 503,
      })
      expect(apiKeyGuard.canActivate).not.toHaveBeenCalled()
    })

    it('does not run later steps or authorization guards after the stage expired', async () => {
      jest.useFakeTimers()
      let release!: (value: boolean) => void
      jwtAuthGuard.canActivate.mockReturnValue(
        new Promise<boolean>((resolve) => {
          release = resolve
        })
      )
      const systemRoles = { requiredRoles: () => [], canActivate: jest.fn() }
      const policies = { canActivate: jest.fn() }
      const candidate = new AuthenticationGuard(
        reflector as unknown as Reflector,
        jwtAuthGuard as unknown as JwtAuthGuard,
        apiKeyGuard as unknown as ApiKeyGuard,
        {} as unknown as AbilityFactory,
        systemRoles as unknown as SystemRolesGuard,
        policies as unknown as PoliciesGuard,
        { canActivate: jest.fn() } as unknown as TeamAccessGuard,
        {} as unknown as PrivilegedAdmissionService,
        {} as unknown as OrganizationContextResolver,
        { assert: async () => undefined } as unknown as MfaJwtAdmissionService,
        { verify: () => undefined } as unknown as BrowserSessionContextService,
        new AuthStageService()
      )
      const outcome = status(candidate.canActivate(createContext()))
      await jest.advanceTimersByTimeAsync(AUTH_STAGE_MS + 1)
      await expect(outcome).resolves.toMatchObject({ status: 503 })
      release(true)
      await jest.advanceTimersByTimeAsync(0)
      expect(systemRoles.canActivate).not.toHaveBeenCalled()
      expect(policies.canActivate).not.toHaveBeenCalled()
    })

    it.each([
      ['false', (release: (v: unknown) => void) => release(false)],
      [
        'a 401',
        (release: (v: unknown) => void) => release(Promise.reject(new HttpException('x', 401))),
      ],
      [
        'a 403',
        (release: (v: unknown) => void) => release(Promise.reject(new HttpException('x', 403))),
      ],
    ])(
      'does not try the next credential after a delayed %s from the first',
      async (_name, settle) => {
        jest.useFakeTimers()
        let release!: (value: unknown) => void
        jwtAuthGuard.canActivate.mockReturnValue(
          new Promise<boolean>((resolve) => {
            release = resolve as (value: unknown) => void
          })
        )
        apiKeyGuard.canActivate.mockResolvedValue(true)
        const outcome = status(guard.canActivate(createContext()))
        await jest.advanceTimersByTimeAsync(AUTH_STAGE_MS + 1)
        await expect(outcome).resolves.toMatchObject({ status: 503 })
        settle(release)
        await jest.advanceTimersByTimeAsync(0)
        expect(apiKeyGuard.canActivate).not.toHaveBeenCalled()
      }
    )

    it('starts no privilege admission when the real MFA fallback read outlives the stage', async () => {
      jest.useFakeTimers()
      let finish!: (value: unknown) => void
      const authority = {
        inspectForRuntime: jest.fn(
          () =>
            new Promise((resolve) => {
              finish = resolve
            })
        ),
      }
      const privilege = { resolve: jest.fn() }
      const principal = { type: 'jwt', sub: 'user-1', email: 'a@example.test', systemRole: 'USER' }
      const request = { user: principal, headers: {} }
      const context = {
        ...createContext(),
        switchToHttp: () => ({ getRequest: () => request }),
      } as unknown as ExecutionContext
      jwtAuthGuard.canActivate.mockResolvedValue(true)
      const candidate = new AuthenticationGuard(
        reflector as unknown as Reflector,
        jwtAuthGuard as unknown as JwtAuthGuard,
        apiKeyGuard as unknown as ApiKeyGuard,
        {} as unknown as AbilityFactory,
        { requiredRoles: () => [], canActivate: jest.fn() } as unknown as SystemRolesGuard,
        { canActivate: jest.fn() } as unknown as PoliciesGuard,
        { canActivate: jest.fn() } as unknown as TeamAccessGuard,
        privilege as unknown as PrivilegedAdmissionService,
        {} as unknown as OrganizationContextResolver,
        new MfaJwtAdmissionService(authority as never),
        { verify: () => undefined } as unknown as BrowserSessionContextService,
        new AuthStageService()
      )
      const outcome = status(candidate.canActivate(context))
      await jest.advanceTimersByTimeAsync(AUTH_STAGE_MS + 1)
      await expect(outcome).resolves.toMatchObject({ status: 503 })
      finish({ admission: { kind: 'admitted' }, currentRole: 'USER' })
      await jest.advanceTimersByTimeAsync(0)
      expect(authority.inspectForRuntime).toHaveBeenCalledTimes(1)
      expect(privilege.resolve).not.toHaveBeenCalled()
    })

    it('keeps a genuine 401 from credential selection as a decision', async () => {
      jwtAuthGuard.canActivate.mockRejectedValueOnce(new HttpException('expired', 401))
      apiKeyGuard.canActivate.mockResolvedValue(false)
      await expect(status(guard.canActivate(createContext()))).resolves.toMatchObject({
        status: 401,
      })
    })
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

  describe('ADR-034 default: no @Auth() decorator → [AuthType.Bearer] only', () => {
    // Pin the runtime fallback the controller-side guardrail in
    // `auth-decorator-coverage.spec.ts` relies on. If this assertion
    // ever flips, the whole bearer-only default story (ADR-034 / OA-11)
    // is broken — a missing decorator would silently let API keys
    // through again.
    it('an undecorated route does not invoke ApiKeyGuard even if JWT fails', async () => {
      reflector.getAllAndOverride.mockReturnValue(undefined)
      jwtAuthGuard.canActivate.mockResolvedValue(false)

      await expect(guard.canActivate(createContext())).rejects.toMatchObject({
        message: 'Unauthorized',
      })

      expect(apiKeyGuard.canActivate).not.toHaveBeenCalled()
    })
  })
})
