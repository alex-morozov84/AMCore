// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('./authenticated-proxy', () => ({ resolveConsoleAccessToken: vi.fn() }))
import { resolveConsoleAccessToken } from './authenticated-proxy'
import { handleConsoleQueues } from './queues-handler'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)
const request = (signal?: AbortSignal) =>
  new Request('https://console.example.test/api/background-work/queues', {
    headers: { cookie: 'session=secret', 'x-forwarded-for': '203.0.113.9' },
    signal,
  })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveConsoleAccessToken).mockResolvedValue({ token: 'access-token' })
  fetchMock.mockResolvedValue(
    new Response('{"queues":[]}', {
      status: 200,
      headers: { 'set-cookie': 'x=1', 'content-type': 'application/json' },
    })
  )
})

describe('fixed background-work queues proxy', () => {
  it('returns the session failure without calling the API when no console session exists', async () => {
    vi.mocked(resolveConsoleAccessToken).mockResolvedValue({
      failure: new Response(null, { status: 401 }),
    })
    expect((await handleConsoleQueues(request())).status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('forwards a GET to one fixed target with the bearer token and no caching', async () => {
    const response = await handleConsoleQueues(request())
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/\/api\/v1\/admin\/background-work\/queues$/)
    expect(init.method).toBe('GET')
    expect(init.cache).toBe('no-store')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer access-token')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('never lets the access token or cookies reach the browser response', async () => {
    const response = await handleConsoleQueues(request())
    const text = await response.text()
    expect(text).not.toContain('access-token')
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('passes the status of an upstream refusal through', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 403 }))
    expect((await handleConsoleQueues(request())).status).toBe(403)
  })

  it('forwards the browser abort and bounds the request with its own deadline', async () => {
    const browser = new AbortController()
    await handleConsoleQueues(request(browser.signal))
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(init.signal?.aborted).toBe(false)
    browser.abort()
    expect(init.signal?.aborted).toBe(true)
  })

  it('answers 503 when the API cannot be reached', async () => {
    fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED'))
    expect((await handleConsoleQueues(request())).status).toBe(503)
  })
})
