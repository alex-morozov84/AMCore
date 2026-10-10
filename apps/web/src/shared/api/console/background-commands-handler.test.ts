// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('./authenticated-proxy', () => ({
  resolveConsoleAccessToken: vi.fn(),
  isConsoleRequestOriginTrusted: vi.fn(),
}))

import { isConsoleRequestOriginTrusted, resolveConsoleAccessToken } from './authenticated-proxy'
import {
  handleConsoleEvidenceReconciliation,
  handleConsoleWorkCommand,
} from './background-commands-handler'

const id = '019a1234-1234-7123-8123-123456789012'
const input = {
  revision: 3,
  disposition: 'acknowledged_unknown',
  reason: 'Inspected worker logs',
  references: ['incident_1'],
}
const upstream = vi.fn()
vi.stubGlobal('fetch', upstream)
const request = (body = JSON.stringify(input)) =>
  new Request('https://console.example.test/api/console/background-work/commands/reconciliation', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(isConsoleRequestOriginTrusted).mockReturnValue(true)
  vi.mocked(resolveConsoleAccessToken).mockResolvedValue({ token: '<fake-access-token>' })
  upstream.mockResolvedValue(new Response('{}', { headers: { 'set-cookie': 'unexpected=1' } }))
})

describe('bounded fixed command reconciliation BFF', () => {
  it('rejects untrusted origin and path injection without reading credentials or forwarding', async () => {
    vi.mocked(isConsoleRequestOriginTrusted).mockReturnValue(false)
    expect((await handleConsoleWorkCommand(request(), id, true)).status).toBe(403)
    vi.mocked(isConsoleRequestOriginTrusted).mockReturnValue(true)
    expect((await handleConsoleWorkCommand(request(), '../auth', true)).status).toBe(400)
    expect(resolveConsoleAccessToken).not.toHaveBeenCalled()
    expect(upstream).not.toHaveBeenCalled()
  })

  it('refuses oversized decoded input and open recovery fields before vault access', async () => {
    expect(
      (await handleConsoleWorkCommand(request(`${' '.repeat(32768)}{}`), id, true)).status
    ).toBe(413)
    expect(
      (
        await handleConsoleWorkCommand(
          request(JSON.stringify({ ...input, url: 'https://attacker.test' })),
          id,
          true
        )
      ).status
    ).toBe(400)
    expect(resolveConsoleAccessToken).not.toHaveBeenCalled()
    expect(upstream).not.toHaveBeenCalled()
  })

  it('does not contact the backend when the session vault is unavailable', async () => {
    vi.mocked(resolveConsoleAccessToken).mockResolvedValue({
      failure: new Response(null, { status: 503 }),
    })
    expect((await handleConsoleWorkCommand(request(), id, true)).status).toBe(503)
    expect(upstream).not.toHaveBeenCalled()
  })

  it('posts exactly the captured disposition to the fixed endpoint with safe headers and no-store', async () => {
    const response = await handleConsoleWorkCommand(request(), id, true)
    expect(upstream).toHaveBeenCalledTimes(1)
    const [path, init] = upstream.mock.calls[0] as [string, RequestInit]
    expect(path).toMatch(new RegExp(`/commands/${id}/reconciliation$`))
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual(input)
    expect(init.cache).toBe('no-store')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer <fake-access-token>')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('requires an evidence incarnation and never permits path injection or oversized reconciliation input', async () => {
    expect((await handleConsoleEvidenceReconciliation(request(), 'email', 'job_1')).status).toBe(
      400
    )
    expect((await handleConsoleEvidenceReconciliation(request(), '../auth', 'job_1')).status).toBe(
      400
    )
    expect(
      (
        await handleConsoleEvidenceReconciliation(
          request(`${' '.repeat(32768)}{}`),
          'email',
          'job_1'
        )
      ).status
    ).toBe(413)
    expect(upstream).not.toHaveBeenCalled()
    expect(resolveConsoleAccessToken).not.toHaveBeenCalled()
  })

  it('forwards only the evidence metadata disposition to its fixed route and preserves204', async () => {
    upstream.mockResolvedValue(new Response(null, { status: 204 }))
    const body = { ...input, incarnation: id }
    const response = await handleConsoleEvidenceReconciliation(
      request(JSON.stringify(body)),
      'email',
      'job_1'
    )
    const [path, init] = upstream.mock.calls[0] as [string, RequestInit]
    expect(path).toMatch(/\/works\/email\/jobs\/job_1\/reconciliation$/)
    expect(JSON.parse(init.body as string)).toEqual(body)
    expect(response.status).toBe(204)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(upstream).toHaveBeenCalledTimes(1)
  })
})
