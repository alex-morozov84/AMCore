// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

import { authFailureResponse } from './auth-failure-response'
import { ContextRequestError } from './context-errors'
import {
  SessionLockTimeoutError,
  SessionNotFoundError,
  SessionPublicationUnprovenError,
  SessionRefreshUnsafeError,
  SessionStageTimeoutError,
  SessionVaultUnavailableError,
} from './errors'

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
    ['SessionStageTimeoutError', new SessionStageTimeoutError('vault read')],
    ['SessionVaultUnavailableError', new SessionVaultUnavailableError(new Error('down'))],
    ['SessionPublicationUnprovenError', new SessionPublicationUnprovenError(new Error('x'))],
    ['a transient network error', Object.assign(new Error('down'), { code: 'network' })],
    ['an uncoded error', new Error('boom')],
  ])('maps %s to 503, not 401 — cannot prove auth, not "logged out"', async (_name, error) => {
    const response = authFailureResponse(makeRequest(), error)
    expect(response.status).toBe(503)
  })
})

it('preserves a bounded source Retry-After for the Console error adapter', async () => {
  const response = authFailureResponse(
    makeRequest(),
    new ContextRequestError(429, 'RATE_LIMIT_EXCEEDED', 75)
  )
  expect(response.status).toBe(429)
  expect(response.headers.get('retry-after')).toBe('75')
  expect(await response.json()).toMatchObject({ errorCode: 'RATE_LIMIT_EXCEEDED' })
})

it('answers a temporary failure with the stable code and invents no Retry-After', async () => {
  const response = authFailureResponse(makeRequest(), new SessionStageTimeoutError('binding check'))
  expect(response.status).toBe(503)
  expect(response.headers.get('retry-after')).toBeNull()
  expect(await response.json()).toMatchObject({ errorCode: 'SERVICE_UNAVAILABLE' })
})

it('keeps a probe 503 without a hint free of Retry-After and relays a given one', () => {
  const plain = authFailureResponse(
    makeRequest(),
    new ContextRequestError(503, 'SERVICE_UNAVAILABLE')
  )
  expect(plain.headers.get('retry-after')).toBeNull()
  const hinted = authFailureResponse(
    makeRequest(),
    new ContextRequestError(503, 'SERVICE_UNAVAILABLE', 12)
  )
  expect(hinted.headers.get('retry-after')).toBe('12')
})
