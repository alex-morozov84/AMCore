// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { handleCredentialAuth } from './credential-auth-handler'
import { mintSession } from './mint-session'
import { isTrustedOrigin } from './origin-guard'
import type * as UpstreamAuthModule from './upstream-auth'
import { callUpstreamAuth, UpstreamAuthError } from './upstream-auth'

vi.mock('server-only', () => ({}))
vi.mock('./origin-guard', () => ({ isTrustedOrigin: vi.fn() }))
vi.mock('./upstream-auth', async () => {
  const actual = await vi.importActual<typeof UpstreamAuthModule>('./upstream-auth')
  return { ...actual, callUpstreamAuth: vi.fn() }
})
vi.mock('./mint-session', () => ({ mintSession: vi.fn() }))

const schema = z.object({ email: z.string(), password: z.string() })

function jsonRequest(body: unknown): Request {
  return new Request('http://next.internal/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('handleCredentialAuth', () => {
  beforeEach(() => {
    vi.mocked(isTrustedOrigin).mockReturnValue(true)
  })

  it('rejects an untrusted origin with 403 and an ApiErrorResponse-shaped body', async () => {
    vi.mocked(isTrustedOrigin).mockReturnValue(false)

    const response = await handleCredentialAuth(jsonRequest({ email: 'a', password: 'b' }), {
      schema,
      backendPath: '/auth/login',
      successStatus: 200,
    })

    expect(response.status).toBe(403)
    expect(callUpstreamAuth).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({
      statusCode: 403,
      errorCode: 'AUTH_ORIGIN_REJECTED',
      path: '/api/auth/login',
      method: 'POST',
    })
  })

  it('rejects a body that fails schema validation with 400 and field-level errors', async () => {
    const response = await handleCredentialAuth(jsonRequest({ email: 'a' }), {
      schema,
      backendPath: '/auth/login',
      successStatus: 200,
    })

    expect(response.status).toBe(400)
    expect(callUpstreamAuth).not.toHaveBeenCalled()
    const body = await response.json()
    expect(body.statusCode).toBe(400)
    expect(body.errorCode).toBeUndefined()
    expect(body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'password' })])
    )
  })

  it('forwards the upstream error status and body verbatim', async () => {
    const errorBody = { errorCode: 'AUTH_INVALID_CREDENTIALS', message: 'bad creds' }
    vi.mocked(callUpstreamAuth).mockRejectedValue(new UpstreamAuthError(401, errorBody))

    const response = await handleCredentialAuth(jsonRequest({ email: 'a', password: 'b' }), {
      schema,
      backendPath: '/auth/login',
      successStatus: 200,
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual(errorBody)
  })

  it('on success, mints a session, sets the cookie, and returns only the user', async () => {
    vi.mocked(callUpstreamAuth).mockResolvedValue({
      user: { id: 'u1' },
      accessToken: 'at-1',
      refreshToken: 'rt-1',
    } as never)
    vi.mocked(mintSession).mockResolvedValue({ sessionId: 'sess-1', user: { id: 'u1' } } as never)

    const response = await handleCredentialAuth(jsonRequest({ email: 'a', password: 'b' }), {
      schema,
      backendPath: '/auth/login',
      successStatus: 200,
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ user: { id: 'u1' } })
    const cookie = response.cookies.get('amcore_session')
    expect(cookie?.value).toBe('sess-1')
    expect(cookie?.httpOnly).toBe(true)
  })
})
