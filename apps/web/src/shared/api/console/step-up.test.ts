// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ContextRequestError } from '@/shared/api/bff/context-errors'

vi.mock('@/shared/api/bff/mfa-source-operation', () => ({
  startSourceReauthentication: vi.fn(),
  completeSourceReauthentication: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('./authenticated-proxy', () => ({
  isConsoleRequestOriginTrusted: vi.fn(),
  resolveConsoleAccessToken: vi.fn(),
}))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

import {
  completeSourceReauthentication,
  startSourceReauthentication,
} from '@/shared/api/bff/mfa-source-operation'

import { isConsoleRequestOriginTrusted, resolveConsoleAccessToken } from './authenticated-proxy'
import { handleConsoleStepUp } from './step-up'

function request(body: unknown = { password: 'correct-horse' }): Request {
  return new Request('https://console.example.test/api/console/auth/step-up', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(isConsoleRequestOriginTrusted).mockReturnValue(true)
  vi.mocked(resolveConsoleAccessToken).mockResolvedValue({
    token: 'access-token',
    bindingHeaders: {},
  })
})

describe('handleConsoleStepUp', () => {
  it('rejects an untrusted origin before validating or resolving a session', async () => {
    vi.mocked(isConsoleRequestOriginTrusted).mockReturnValue(false)

    const response = await handleConsoleStepUp(request())

    expect(response.status).toBe(403)
    expect(resolveConsoleAccessToken).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a missing password before resolving a session', async () => {
    const response = await handleConsoleStepUp(request({ password: '' }))

    expect(response.status).toBe(400)
    expect(resolveConsoleAccessToken).not.toHaveBeenCalled()
  })

  it('propagates the session-resolution failure verbatim', async () => {
    vi.mocked(resolveConsoleAccessToken).mockResolvedValue({
      failure: new Response(null, { status: 401 }),
    })

    const response = await handleConsoleStepUp(request())

    expect(response.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('on upstream success, discards the token-bearing body and returns a bare 204', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ accessToken: 'super-secret-token' }, 200))

    const response = await handleConsoleStepUp(request())

    expect(response.status).toBe(204)
    const text = await response.text()
    expect(text).toBe('')
    expect(text).not.toContain('super-secret-token')
  })

  it('sends the password to the fixed upstream step-up endpoint with the resolved bearer token', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ accessToken: 'x' }, 200))

    await handleConsoleStepUp(request({ password: 'correct-horse' }))

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/\/auth\/step-up$/)
    expect((init.headers as Headers).get('authorization')).toBe('Bearer access-token')
    expect(JSON.parse(init.body as string)).toEqual({ password: 'correct-horse' })
  })

  it('relays an upstream failure body (e.g. STEP_UP_METHOD_UNAVAILABLE) without touching it', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ statusCode: 403, errorCode: 'STEP_UP_METHOD_UNAVAILABLE' }, 403)
    )

    const response = await handleConsoleStepUp(request())

    expect(response.status).toBe(403)
    const body = (await response.json()) as { errorCode: string }
    expect(body.errorCode).toBe('STEP_UP_METHOD_UNAVAILABLE')
  })

  it('maps a network failure reaching the upstream to 503', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))

    const response = await handleConsoleStepUp(request())

    expect(response.status).toBe(503)
  })
})

it('keeps upstream 202 pending and returns only a source-bound public handle', async () => {
  fetchMock.mockResolvedValue(
    jsonResponse({ kind: 'proof_required', requiredProofs: ['second_factor'] }, 202)
  )
  const pending = {
    kind: 'proof_required' as const,
    flowBinding: crypto.randomUUID(),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    requiredProofs: ['second_factor' as const],
  }
  vi.mocked(startSourceReauthentication).mockResolvedValue(pending)
  const result = await handleConsoleStepUp(request())
  expect(result.status).toBe(202)
  expect(await result.json()).toEqual(pending)
})
it('accepts only a fully completed source flow as 204', async () => {
  vi.mocked(completeSourceReauthentication).mockResolvedValue(undefined)
  const body = { flowBinding: crypto.randomUUID(), operationId: crypto.randomUUID() }
  const result = await handleConsoleStepUp(request(body))
  expect(result.status).toBe(204)
  expect(fetchMock).not.toHaveBeenCalled()
})
it('never reports malformed successful upstream bodies as completed', async () => {
  fetchMock.mockResolvedValue(jsonResponse({ unexpected: true }, 200))
  expect((await handleConsoleStepUp(request())).status).toBe(503)
})

it('preserves a source-flow budget refusal and Retry-After instead of completing step-up', async () => {
  vi.mocked(completeSourceReauthentication).mockRejectedValue(
    new ContextRequestError(429, 'RATE_LIMIT_EXCEEDED', 60)
  )
  const result = await handleConsoleStepUp(
    request({ flowBinding: crypto.randomUUID(), operationId: crypto.randomUUID() })
  )
  expect(result.status).toBe(429)
  expect(result.headers.get('retry-after')).toBe('60')
})
