import type { ExecutionContext } from '@nestjs/common'

import { AuthErrorCode } from '@amcore/shared'

import { AppException } from '../../../common/exceptions'
import { EnvService } from '../../../env/env.service'

import { OriginCheckGuard } from './origin-check.guard'

describe('OriginCheckGuard', () => {
  const trustedOrigin = 'http://localhost:3002'
  let guard: OriginCheckGuard

  beforeEach(() => {
    guard = new OriginCheckGuard({
      get: jest.fn(() => [trustedOrigin]),
    } as unknown as EnvService)
  })

  function context(headers: Record<string, string | undefined>): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ headers }),
      }),
    } as ExecutionContext
  }

  function expectRejected(headers: Record<string, string | undefined>): AppException {
    try {
      guard.canActivate(context(headers))
    } catch (error) {
      return error as AppException
    }

    throw new Error('Expected guard to reject request')
  }

  it('allows an exact trusted Origin header', () => {
    expect(guard.canActivate(context({ origin: trustedOrigin }))).toBe(true)
  })

  it('allows a trusted Referer fallback when Origin is absent', () => {
    expect(guard.canActivate(context({ referer: `${trustedOrigin}/auth/callback?x=1` }))).toBe(true)
  })

  it('rejects a mismatched Origin header', () => {
    const error = expectRejected({ origin: 'https://evil.example' })
    expect(error).toBeInstanceOf(AppException)
    expect(error.errorCode).toBe(AuthErrorCode.AUTH_ORIGIN_REJECTED)
  })

  it('rejects a malformed Referer header', () => {
    const error = expectRejected({ referer: '://bad-ref' })
    expect(error).toBeInstanceOf(AppException)
    expect(error.errorCode).toBe(AuthErrorCode.AUTH_ORIGIN_REJECTED)
  })

  it('allows requests when both Origin and Referer are absent', () => {
    expect(guard.canActivate(context({}))).toBe(true)
  })
})
