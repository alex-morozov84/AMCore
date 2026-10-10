// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('./authenticated-proxy', () => ({ resolveConsoleAccessToken: vi.fn() }))

import { resolveConsoleAccessToken } from './authenticated-proxy'
import { handleConsoleWorkJobs } from './background-work-read-handler'

const upstream = vi.fn()
vi.stubGlobal('fetch', upstream)
const request = (query = '') =>
  new Request(`https://console.example.test/api/console/background-work/works/image/jobs${query}`)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveConsoleAccessToken).mockResolvedValue({ token: '<fake-access-token>' })
  upstream.mockResolvedValue(new Response('{}', { headers: { 'set-cookie': 'unexpected=1' } }))
})

describe('fixed registered-work reads', () => {
  it('rejects path injection and an open upstream query before fetching', async () => {
    expect((await handleConsoleWorkJobs(request(), '../auth')).status).toBe(400)
    expect(
      (await handleConsoleWorkJobs(request('?url=https://attacker.test'), 'image')).status
    ).toBe(400)
    expect((await handleConsoleWorkJobs(request(), 'image', '../tokens')).status).toBe(400)
    expect(upstream).not.toHaveBeenCalled()
  })

  it('never fetches when the Console vault rejects access', async () => {
    vi.mocked(resolveConsoleAccessToken).mockResolvedValue({
      failure: new Response(null, { status: 401 }),
    })
    expect((await handleConsoleWorkJobs(request(), 'image')).status).toBe(401)
    expect(upstream).not.toHaveBeenCalled()
  })

  it('forwards only a bounded status window, with bearer auth and private no-store', async () => {
    const response = await handleConsoleWorkJobs(request('?state=failed&page=2&limit=25'), 'image')
    const [path, init] = upstream.mock.calls[0] as [string, RequestInit]
    expect(path).toMatch(
      /\/api\/v1\/admin\/background-work\/works\/image\/jobs\?state=failed&page=2&limit=25$/
    )
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer <fake-access-token>')
    expect(init.cache).toBe('no-store')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('uses the fixed detail endpoint and preserves an unavailable history response', async () => {
    upstream.mockResolvedValue(new Response('{}', { status: 404 }))
    expect((await handleConsoleWorkJobs(request(), 'image', 'job_1')).status).toBe(404)
    expect(upstream.mock.calls[0]?.[0]).toMatch(/\/works\/image\/jobs\/job_1$/)
  })

  it('forwards the closed independent evidence source without exposing an upstream selector', async () => {
    await handleConsoleWorkJobs(request('?source=PG_evidence'), 'email')
    expect(upstream.mock.calls[0]?.[0]).toMatch(
      /\/works\/email\/jobs\?source=PG_evidence&state=failed&page=1&limit=25$/
    )
    expect(
      (await handleConsoleWorkJobs(request('?source=redis://attacker.test'), 'email')).status
    ).toBe(400)
    expect(upstream).toHaveBeenCalledTimes(1)
  })
})
