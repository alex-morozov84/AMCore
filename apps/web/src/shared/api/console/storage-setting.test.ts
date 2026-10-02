// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('./authenticated-proxy', () => ({
  isConsoleRequestOriginTrusted: vi.fn(),
  resolveConsoleAccessToken: vi.fn(),
}))
import { isConsoleRequestOriginTrusted, resolveConsoleAccessToken } from './authenticated-proxy'
import { handleConsoleStorageSetting } from './storage-setting'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)
const request = (body: unknown = { intervalSeconds: 60, expectedRevision: 0 }) =>
  new Request('https://console.example.test/api/runtime-settings/storage-probe', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(isConsoleRequestOriginTrusted).mockReturnValue(true)
  vi.mocked(resolveConsoleAccessToken).mockResolvedValue({ token: 'access-token' })
  fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))
})
describe('fixed storage setting proxy', () => {
  it('requires trusted mutation origin before resolving credentials', async () => {
    vi.mocked(isConsoleRequestOriginTrusted).mockReturnValue(false)
    expect((await handleConsoleStorageSetting(request())).status).toBe(403)
    expect(resolveConsoleAccessToken).not.toHaveBeenCalled()
  })
  it('rejects arbitrary keys and malformed revisions before forwarding', async () => {
    expect(
      (
        await handleConsoleStorageSetting(
          request({ intervalSeconds: 60, expectedRevision: 0, key: 'JWT_SECRET' })
        )
      ).status
    ).toBe(400)
    expect(
      (
        await handleConsoleStorageSetting(
          request({ intervalSeconds: 60, expectedRevision: 2147483648 })
        )
      ).status
    ).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('forwards only the typed body to a fixed target and does not expose credentials', async () => {
    const response = await handleConsoleStorageSetting(request())
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/\/admin\/runtime-settings\/storage-probe$/)
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body as string)).toEqual({ intervalSeconds: 60, expectedRevision: 0 })
    expect((init.headers as Headers).get('authorization')).toBe('Bearer access-token')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.text()).not.toContain('access-token')
  })
  it('reads the fixed authoritative endpoint and reports ambiguous upstream failure', async () => {
    await handleConsoleStorageSetting(
      new Request('https://console.example.test/api/runtime-settings/storage-probe')
    )
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: 'GET', cache: 'no-store' })
    fetchMock.mockRejectedValue(new Error('timeout'))
    expect((await handleConsoleStorageSetting(request())).status).toBe(503)
  })
})
