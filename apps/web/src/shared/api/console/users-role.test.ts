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
import { handleConsoleUserRoleUpdate } from './users-role'

function request(body: unknown = { systemRole: 'SUPER_ADMIN' }): Request {
  return new Request('https://console.example.test/api/console/users/u1/role', {
    method: 'PATCH',
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

describe('handleConsoleUserRoleUpdate', () => {
  it('rejects an untrusted origin before validating or resolving a session', async () => {
    vi.mocked(isConsoleRequestOriginTrusted).mockReturnValue(false)

    const response = await handleConsoleUserRoleUpdate(request(), 'u1')

    expect(response.status).toBe(403)
    expect(resolveConsoleAccessToken).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a body that fails updateUserSystemRoleSchema', async () => {
    const response = await handleConsoleUserRoleUpdate(request({ systemRole: 'NOT_A_ROLE' }), 'u1')

    expect(response.status).toBe(400)
    expect(resolveConsoleAccessToken).not.toHaveBeenCalled()
  })

  it('propagates the session-resolution failure verbatim', async () => {
    vi.mocked(resolveConsoleAccessToken).mockResolvedValue({
      failure: new Response(null, { status: 401 }),
    })

    const response = await handleConsoleUserRoleUpdate(request(), 'u1')

    expect(response.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('forwards to the fixed backend target for the route-supplied id, never a body-supplied one', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'u1', systemRole: 'SUPER_ADMIN' }))

    await handleConsoleUserRoleUpdate(request({ systemRole: 'SUPER_ADMIN' }), 'route-id-should-win')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/\/admin\/users\/route-id-should-win$/)
    expect(init.method).toBe('PATCH')
    expect((init.headers as Headers).get('authorization')).toBe('Bearer access-token')
    expect(JSON.parse(init.body as string)).toEqual({ systemRole: 'SUPER_ADMIN' })
  })

  it('streams the upstream success response back (no credential in this body)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'u1', systemRole: 'SUPER_ADMIN' }, 200))

    const response = await handleConsoleUserRoleUpdate(request(), 'u1')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ id: 'u1', systemRole: 'SUPER_ADMIN' })
  })

  it('relays an upstream business-rule failure (e.g. last-admin/self-change) as-is', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ statusCode: 400, errorCode: 'BUSINESS_RULE_VIOLATION' }, 400)
    )

    const response = await handleConsoleUserRoleUpdate(request(), 'u1')

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ errorCode: 'BUSINESS_RULE_VIOLATION' })
  })

  it('maps a network failure reaching the upstream to a controlled 503', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))

    const response = await handleConsoleUserRoleUpdate(request(), 'u1')

    expect(response.status).toBe(503)
  })
})
