import { AuthErrorCode } from '@amcore/shared'
import { describe, expect, it } from 'vitest'

import { ApiNetworkError, ApiRequestError } from '@/shared/api/http-client'

import { classifyRegisterError } from './register-outcome'

const failure = (status: number, errorCode?: string) =>
  new ApiRequestError(status, { statusCode: status, message: 'x', errorCode } as never)

describe('classifyRegisterError', () => {
  it('recognises the confirmed-creation code', () => {
    expect(classifyRegisterError(failure(503, AuthErrorCode.REGISTRATION_SIGN_IN_REQUIRED))).toBe(
      'created'
    )
  })

  it.each([
    failure(500),
    failure(502),
    failure(503),
    new ApiNetworkError(new TypeError('Failed to fetch')),
  ])('treats a missing or unusable answer as unknown', (error) => {
    expect(classifyRegisterError(error)).toBe('unknown')
  })

  it.each([
    failure(409, AuthErrorCode.EMAIL_ALREADY_EXISTS),
    failure(400, 'VALIDATION_ERROR'),
    failure(429, AuthErrorCode.RATE_LIMIT_EXCEEDED),
    failure(403, AuthErrorCode.PUBLIC_SIGNUP_DISABLED),
    undefined,
    null,
  ])('leaves ordinary refusals alone', (error) => {
    expect(classifyRegisterError(error)).toBe('other')
  })
})
