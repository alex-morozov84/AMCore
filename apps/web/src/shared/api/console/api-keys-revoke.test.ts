// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('./authenticated-proxy', () => ({
  isConsoleRequestOriginTrusted: vi.fn(),
  resolveConsoleAccessToken: vi.fn(),
}))
import { handleConsoleApiKeyRevoke } from './api-keys-revoke'
import { isConsoleRequestOriginTrusted, resolveConsoleAccessToken } from './authenticated-proxy'

const id = 'cm123456789012345678901234'
const fetchMock = vi.fn()
function request(body: unknown = { ids: [id] }) {
  return new Request('https://console.example.test/api/console/api-keys/revoke', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  vi.mocked(isConsoleRequestOriginTrusted).mockReturnValue(true)
  vi.mocked(resolveConsoleAccessToken).mockResolvedValue({ token: 'test-token' })
})
describe('fixed API key mutation transport', () => {
  it('rejects origin before session or network and prevents caching', async () => {
    vi.mocked(isConsoleRequestOriginTrusted).mockReturnValue(false)
    const response = await handleConsoleApiKeyRevoke(request())
    expect(response.status).toBe(403)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(resolveConsoleAccessToken).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it.each([
    { ids: [id, id] },
    { ids: [] },
    { ids: [id], path: '/auth/refresh' },
    { ids: Array(101).fill(id) },
  ])('rejects invalid targets before forwarding: %j', async (body) => {
    expect((await handleConsoleApiKeyRevoke(request(body))).status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('forwards validated IDs once to the fixed bulk target with session token and no-store', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ requestedCount: 1, affectedCount: 1 }), { status: 200 })
    )
    const response = await handleConsoleApiKeyRevoke(request())
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/\/admin\/api-keys\/revoke$/)
    expect(init).toMatchObject({
      method: 'POST',
      cache: 'no-store',
      body: JSON.stringify({ ids: [id] }),
    })
    expect((init.headers as Headers).get('authorization')).toBe('Bearer test-token')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toEqual({ requestedCount: 1, affectedCount: 1 })
  })
  it('uses the route CUID for DELETE and rejects malformed IDs', async () => {
    expect((await handleConsoleApiKeyRevoke(request(), '../auth')).status).toBe(400)
    fetchMock.mockResolvedValue(new Response('{}'))
    await handleConsoleApiKeyRevoke(request(), id)
    expect(fetchMock.mock.calls[0]?.[0]).toMatch(new RegExp(`/api-keys/${id}$`))
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'DELETE' })
  })
  it('relays429/Retry-After once and maps network failure to503', async () => {
    fetchMock.mockResolvedValue(
      new Response('{}', { status: 429, headers: { 'Retry-After': '12' } })
    )
    const response = await handleConsoleApiKeyRevoke(request())
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('12')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    fetchMock.mockRejectedValue(new TypeError('network'))
    expect((await handleConsoleApiKeyRevoke(request())).status).toBe(503)
  })
})
