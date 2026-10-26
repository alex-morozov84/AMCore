// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

import { ContextRequestError } from './context-errors'
import { registrationSignInRequiredResponse, withCreatedOutcome } from './registration-outcome'

vi.mock('server-only', () => ({}))

describe('registration outcome', () => {
  it('builds a 503 with the code, no cookie and no Retry-After', async () => {
    const response = registrationSignInRequiredResponse(
      new Request('http://web.test/api/auth/register', { method: 'POST' })
    )
    expect(response.status).toBe(503)
    expect(response.headers.get('retry-after')).toBeNull()
    expect(response.headers.get('set-cookie')).toBeNull()
    await expect(response.json()).resolves.toMatchObject({
      statusCode: 503,
      errorCode: 'REGISTRATION_SIGN_IN_REQUIRED',
      path: '/api/auth/register',
    })
  })

  it('passes a result through untouched', async () => {
    await expect(
      withCreatedOutcome(
        () => true,
        async () => 'ok'
      )
    ).resolves.toBe('ok')
  })

  it('rethrows the original error until creation is observed', async () => {
    const failure = new Error('abort')
    await expect(
      withCreatedOutcome(
        () => false,
        async () => {
          throw failure
        }
      )
    ).rejects.toBe(failure)
  })

  it('replaces any failure with the created-account error once creation is observed', async () => {
    let created = false
    await expect(
      withCreatedOutcome(
        () => created,
        async () => {
          created = true
          throw new Error('anything')
        }
      )
    ).rejects.toMatchObject({
      status: 503,
      errorCode: 'REGISTRATION_SIGN_IN_REQUIRED',
      constructor: ContextRequestError,
    })
  })
})
