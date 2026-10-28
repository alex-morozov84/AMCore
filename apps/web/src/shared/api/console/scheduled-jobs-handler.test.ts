// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('./authenticated-proxy', () => ({ resolveConsoleAccessToken: vi.fn() }))
import { resolveConsoleAccessToken } from './authenticated-proxy'
import { handleConsoleScheduledJobRuns, handleConsoleScheduledJobs } from './scheduled-jobs-handler'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)
const request = (signal?: AbortSignal) =>
  new Request('https://console.example.test/api/scheduled-jobs', {
    headers: { cookie: 'session=secret', 'x-forwarded-for': '203.0.113.9' },
    signal,
  })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveConsoleAccessToken).mockResolvedValue({
    token: 'access-token',
    bindingHeaders: {},
  })
  fetchMock.mockResolvedValue(
    new Response('{"jobs":[]}', {
      status: 200,
      headers: { 'set-cookie': 'x=1', 'content-type': 'application/json' },
    })
  )
})

describe('fixed scheduled-jobs proxy', () => {
  it('returns the session failure without calling the API when no console session exists', async () => {
    vi.mocked(resolveConsoleAccessToken).mockResolvedValue({
      failure: new Response(null, { status: 401 }),
    })
    expect((await handleConsoleScheduledJobs(request())).status).toBe(401)
    expect((await handleConsoleScheduledJobRuns(request(), 'cleanup')).status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('forwards the list to one fixed target with the bearer token and no caching', async () => {
    const response = await handleConsoleScheduledJobs(request())
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/\/api\/v1\/admin\/background-work\/scheduled-jobs$/)
    expect(init.method).toBe('GET')
    expect(init.cache).toBe('no-store')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer access-token')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('puts only a validated job id into the history path', async () => {
    await handleConsoleScheduledJobRuns(request(), 'notification-retention')
    expect(fetchMock.mock.calls[0]?.[0]).toMatch(/\/scheduled-jobs\/notification-retention\/runs$/)
    for (const bad of ['../queues', 'a/b', 'Cleanup', '', 'x'.repeat(65), 'a?b=c']) {
      fetchMock.mockClear()
      expect((await handleConsoleScheduledJobRuns(request(), bad)).status).toBe(400)
      expect(fetchMock).not.toHaveBeenCalled()
    }
  })

  it('never lets the access token or cookies reach the browser response', async () => {
    const response = await handleConsoleScheduledJobs(request())
    expect(await response.text()).not.toContain('access-token')
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('passes an upstream refusal through, forwards the abort and answers 503 when unreachable', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 403 }))
    expect((await handleConsoleScheduledJobs(request())).status).toBe(403)

    const browser = new AbortController()
    await handleConsoleScheduledJobs(request(browser.signal))
    const init = fetchMock.mock.calls[1]?.[1] as RequestInit
    browser.abort()
    expect(init.signal?.aborted).toBe(true)

    fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED'))
    expect((await handleConsoleScheduledJobs(request())).status).toBe(503)
  })
})
