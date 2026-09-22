// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('./authenticated-proxy', () => ({
  isConsoleRequestOriginTrusted: vi.fn(),
  resolveConsoleAccessToken: vi.fn(),
}))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

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
  vi.mocked(resolveConsoleAccessToken).mockResolvedValue({ token: 'access-token' })
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
