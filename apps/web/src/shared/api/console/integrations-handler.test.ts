// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('./authenticated-proxy', () => ({
  resolveConsoleAccessToken: vi.fn(),
  isConsoleRequestOriginTrusted: vi.fn(),
}))
import { isConsoleRequestOriginTrusted, resolveConsoleAccessToken } from './authenticated-proxy'
import { handleConsoleIntegrations } from './integrations-handler'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)
const ATTEMPT = 'A'.repeat(22)

const get = () => new Request('https://console.example.test/api/integrations', { method: 'GET' })
const post = (body?: unknown) =>
  new Request('https://console.example.test/api/integrations/email/probe', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'session=secret' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveConsoleAccessToken).mockResolvedValue({ token: 'access-token' })
  vi.mocked(isConsoleRequestOriginTrusted).mockReturnValue(true)
  fetchMock.mockResolvedValue(
    new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  )
})

describe('fixed integrations proxy', () => {
  it('forwards the list to one fixed route with the bearer token and no caching', async () => {
    const response = await handleConsoleIntegrations(get(), { kind: 'list' })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/\/api\/v1\/admin\/integrations$/)
    expect(init.method).toBe('GET')
    expect(init.cache).toBe('no-store')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer access-token')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('rejects an untrusted origin on a POST before any upstream call', async () => {
    vi.mocked(isConsoleRequestOriginTrusted).mockReturnValue(false)
    expect(
      (
        await handleConsoleIntegrations(post({ attemptId: ATTEMPT }), {
          kind: 'probe',
          id: 'email',
        })
      ).status
    ).toBe(403)
    expect((await handleConsoleIntegrations(post(), { kind: 'prepare', id: 'email' })).status).toBe(
      403
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('puts only validated identifiers into the upstream path', async () => {
    for (const bad of ['../queues', 'a/b', 'Email', '', 'x'.repeat(40), 'a?b=c']) {
      expect((await handleConsoleIntegrations(post(), { kind: 'prepare', id: bad })).status).toBe(
        400
      )
    }
    for (const bad of ['short', '../x', 'A'.repeat(23), 'A'.repeat(21) + '/']) {
      expect(
        (await handleConsoleIntegrations(get(), { kind: 'receipt', id: 'email', attemptId: bad }))
          .status
      ).toBe(400)
    }
    expect(fetchMock).not.toHaveBeenCalled()
    await handleConsoleIntegrations(get(), { kind: 'receipt', id: 'email', attemptId: ATTEMPT })
    expect(fetchMock.mock.calls[0]?.[0]).toMatch(
      new RegExp(`/admin/integrations/email/probe/${ATTEMPT}$`)
    )
  })

  it('accepts only the attempt id in the probe body: no recipient, subject or text', async () => {
    for (const body of [
      { attemptId: ATTEMPT, to: 'x@example.com' },
      { attemptId: ATTEMPT, subject: 'hi' },
      { recipientToken: 'abc' },
      {},
      null,
    ]) {
      expect(
        (await handleConsoleIntegrations(post(body), { kind: 'probe', id: 'email' })).status
      ).toBe(400)
    }
    expect(fetchMock).not.toHaveBeenCalled()
    await handleConsoleIntegrations(post({ attemptId: ATTEMPT }), { kind: 'probe', id: 'email' })
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify({ attemptId: ATTEMPT }))
  })

  it('gives the test send a longer budget than reads, and never retries a POST on its own', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    await handleConsoleIntegrations(get(), { kind: 'list' })
    await handleConsoleIntegrations(post({ attemptId: ATTEMPT }), { kind: 'probe', id: 'email' })
    expect(timeout.mock.calls.map(([ms]) => ms)).toEqual([5_000, 20_000])
    fetchMock.mockClear()
    fetchMock.mockRejectedValue(new Error('network'))
    const failed = await handleConsoleIntegrations(post({ attemptId: ATTEMPT }), {
      kind: 'probe',
      id: 'email',
    })
    expect(failed.status).toBe(503)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    timeout.mockRestore()
  })

  it('never lets the access token or cookies reach the browser response', async () => {
    fetchMock.mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'set-cookie': 'x=1' } })
    )
    const response = await handleConsoleIntegrations(get(), { kind: 'list' })
    expect(await response.text()).not.toContain('access-token')
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('returns the session failure without calling the API when no console session exists', async () => {
    vi.mocked(resolveConsoleAccessToken).mockResolvedValue({
      failure: new Response(null, { status: 401 }),
    })
    expect((await handleConsoleIntegrations(get(), { kind: 'list' })).status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
