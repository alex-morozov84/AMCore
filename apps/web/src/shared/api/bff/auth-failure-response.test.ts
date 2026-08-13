// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

import { authFailureResponse } from './auth-failure-response'
import { SessionLockTimeoutError, SessionNotFoundError, SessionRefreshUnsafeError } from './errors'

vi.mock('server-only', () => ({}))

function makeRequest(): Request {
  return new Request('http://next.internal/api/auth/sessions')
}

describe('authFailureResponse', () => {
  it.each([
    ['SessionNotFoundError', new SessionNotFoundError('sess-1')],
    ['SessionRefreshUnsafeError', new SessionRefreshUnsafeError('sess-1')],
    [
      'an explicit invalid-refresh error',
      Object.assign(new Error('rejected'), { code: 'invalid' }),
    ],
    [
      'an explicit reuse-detected error',
      Object.assign(new Error('reused'), { code: 'reuse-detected' }),
    ],
  ])('maps %s to 401', async (_name, error) => {
    const response = authFailureResponse(makeRequest(), error)
    expect(response.status).toBe(401)
  })

  it.each([
    ['SessionLockTimeoutError', new SessionLockTimeoutError('sess-1')],
    ['a transient network error', Object.assign(new Error('down'), { code: 'network' })],
    ['an uncoded error', new Error('boom')],
  ])('maps %s to 503, not 401 — cannot prove auth, not "logged out"', async (_name, error) => {
    const response = authFailureResponse(makeRequest(), error)
    expect(response.status).toBe(503)
  })
})
