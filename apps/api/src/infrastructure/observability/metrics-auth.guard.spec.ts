import { ExecutionContext } from '@nestjs/common'

import { MetricsAuthGuard } from './metrics-auth.guard'

import { AppException } from '@/common/exceptions'
import { EnvService } from '@/env/env.service'

describe('MetricsAuthGuard', () => {
  function guard(env: Partial<Record<'METRICS_ENABLED' | 'METRICS_AUTH_TOKEN', unknown>>) {
    const envService = {
      get: jest.fn((key: keyof typeof env) => env[key]),
    } as unknown as EnvService
    return new MetricsAuthGuard(envService)
  }

  function ctx(authorization?: string): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { authorization },
        }),
      }),
    } as unknown as ExecutionContext
  }

  it('allows requests when metrics are disabled', () => {
    expect(guard({ METRICS_ENABLED: false, METRICS_AUTH_TOKEN: 'secret' }).canActivate(ctx())).toBe(
      true
    )
  })

  it('allows requests when no metrics token is configured', () => {
    expect(guard({ METRICS_ENABLED: true }).canActivate(ctx())).toBe(true)
  })

  it('allows a matching bearer token', () => {
    expect(
      guard({ METRICS_ENABLED: true, METRICS_AUTH_TOKEN: 'secret' }).canActivate(
        ctx('Bearer secret')
      )
    ).toBe(true)
  })

  it('rejects a missing or invalid bearer token', () => {
    const sut = guard({ METRICS_ENABLED: true, METRICS_AUTH_TOKEN: 'secret' })

    expect(() => sut.canActivate(ctx())).toThrow(AppException)
    expect(() => sut.canActivate(ctx('Bearer wrong'))).toThrow(AppException)
  })
})
