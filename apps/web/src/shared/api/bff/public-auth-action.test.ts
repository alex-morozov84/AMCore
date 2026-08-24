// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { isTrustedOrigin } from './origin-guard'
import { handlePublicAuthAction } from './public-auth-action'

vi.mock('server-only', () => ({}))
vi.mock('./origin-guard', () => ({ isTrustedOrigin: vi.fn() }))

const schema = z.object({ email: z.string() })

const originalFetch = global.fetch

function jsonRequest(body: unknown): Request {
  return new Request('http://next.internal/api/auth/forgot-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function mockFetchResponse(status: number, body: unknown): void {
  global.fetch = vi.fn().mockResolvedValue(
    new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: status === 204 ? undefined : { 'content-type': 'application/json' },
    })
  ) as typeof fetch
}

describe('handlePublicAuthAction', () => {
  beforeEach(() => {
    vi.mocked(isTrustedOrigin).mockReturnValue(true)
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('rejects an untrusted origin with 403 and an ApiErrorResponse-shaped body', async () => {
    vi.mocked(isTrustedOrigin).mockReturnValue(false)
    global.fetch = vi.fn() as typeof fetch

    const response = await handlePublicAuthAction(jsonRequest({ email: 'a@example.com' }), {
      schema,
      backendPath: '/auth/forgot-password',
    })

    expect(response.status).toBe(403)
    expect(global.fetch).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({
      statusCode: 403,
      errorCode: 'AUTH_ORIGIN_REJECTED',
      path: '/api/auth/forgot-password',
      method: 'POST',
    })
  })

  it('rejects a body that fails schema validation with 400 and field-level errors', async () => {
    global.fetch = vi.fn() as typeof fetch

    const response = await handlePublicAuthAction(jsonRequest({}), {
      schema,
      backendPath: '/auth/forgot-password',
    })

    expect(response.status).toBe(400)
    expect(global.fetch).not.toHaveBeenCalled()
    const body = await response.json()
    expect(body.statusCode).toBe(400)
    expect(body.errorCode).toBeUndefined()
    expect(body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'email' })])
    )
  })

  it('forwards a 200 upstream success body verbatim (forgot-password/resend-verification shape)', async () => {
    mockFetchResponse(200, { message: 'If an account with that email exists, ...' })

    const response = await handlePublicAuthAction(jsonRequest({ email: 'a@example.com' }), {
      schema,
      backendPath: '/auth/forgot-password',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      message: 'If an account with that email exists, ...',
    })
  })

  it('forwards a 204 upstream success with no body (reset-password/verify-email shape)', async () => {
    mockFetchResponse(204, undefined)

    const response = await handlePublicAuthAction(jsonRequest({ email: 'a@example.com' }), {
      schema,
      backendPath: '/auth/reset-password',
    })

    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
  })

  it('forwards the upstream error status and body verbatim', async () => {
    mockFetchResponse(401, { errorCode: 'TOKEN_INVALID', message: 'Invalid or expired token' })

    const response = await handlePublicAuthAction(jsonRequest({ email: 'a@example.com' }), {
      schema,
      backendPath: '/auth/reset-password',
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      errorCode: 'TOKEN_INVALID',
      message: 'Invalid or expired token',
    })
  })
})
