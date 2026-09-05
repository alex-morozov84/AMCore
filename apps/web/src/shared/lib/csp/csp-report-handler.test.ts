// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/shared/api/bff/redis-client', () => ({
  getWebRedisClient: vi.fn(),
}))
vi.mock('@/shared/api/bff/trusted-client-ip', () => ({
  resolveTrustedClientIp: vi.fn(),
}))

const { getWebRedisClient } = await import('@/shared/api/bff/redis-client')
const { resolveTrustedClientIp } = await import('@/shared/api/bff/trusted-client-ip')
const { handleCspReport } = await import('./csp-report-handler')

function makeRequest(
  body: string,
  contentType: string,
  headers: Record<string, string> = {}
): Request {
  return new Request('http://localhost/api/csp-report', {
    method: 'POST',
    body,
    headers: { 'content-type': contentType, ...headers },
  })
}

describe('handleCspReport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(resolveTrustedClientIp).mockReturnValue(null)
    vi.mocked(getWebRedisClient).mockResolvedValue({
      incr: vi.fn().mockResolvedValue(1),
      expire: vi.fn(),
    } as never)
  })

  it('accepts a well-formed legacy csp-report and responds 204', async () => {
    const request = makeRequest(
      JSON.stringify({
        'csp-report': {
          'document-uri': 'https://example.com/',
          'violated-directive': 'script-src',
        },
      }),
      'application/csp-report'
    )

    const response = await handleCspReport(request)

    expect(response.status).toBe(204)
  })

  it('accepts a well-formed reports+json body and responds 204', async () => {
    const request = makeRequest(
      JSON.stringify([{ type: 'csp-violation', body: { effectiveDirective: 'style-src-elem' } }]),
      'application/reports+json'
    )

    expect((await handleCspReport(request)).status).toBe(204)
  })

  it('rejects an unexpected content-type without touching Redis, still 204', async () => {
    const request = makeRequest('{}', 'application/json')

    const response = await handleCspReport(request)

    expect(response.status).toBe(204)
    expect(getWebRedisClient).not.toHaveBeenCalled()
  })

  it('rejects an oversized body via Content-Length, still 204, no Redis call', async () => {
    const request = makeRequest('{}', 'application/csp-report', { 'content-length': '999999' })

    const response = await handleCspReport(request)

    expect(response.status).toBe(204)
    expect(getWebRedisClient).not.toHaveBeenCalled()
  })

  it('is rate-limited after the window is exceeded for the same client key', async () => {
    vi.mocked(resolveTrustedClientIp).mockReturnValue('203.0.113.7')
    const incr = vi.fn().mockResolvedValue(21)
    vi.mocked(getWebRedisClient).mockResolvedValue({ incr, expire: vi.fn() } as never)

    const request = makeRequest(JSON.stringify({ 'csp-report': {} }), 'application/csp-report')

    const response = await handleCspReport(request)

    expect(response.status).toBe(204)
    expect(incr).toHaveBeenCalledWith(expect.stringContaining('203.0.113.7'))
  })

  it('still accepts the report if Redis itself is unreachable (fails open)', async () => {
    vi.mocked(getWebRedisClient).mockRejectedValue(new Error('ECONNREFUSED'))

    const request = makeRequest(JSON.stringify({ 'csp-report': {} }), 'application/csp-report')

    expect((await handleCspReport(request)).status).toBe(204)
  })

  it('still responds promptly, within the acquire timeout, if Redis never settles at all', async () => {
    // getWebRedisClient()'s underlying connect() never rejects against an
    // unreachable Redis (indefinite retry, ADR-068) — reproduced for real
    // against the standalone server before this test was added (a stuck
    // curl request). A mocked promise that never resolves stands in for
    // that here.
    vi.mocked(getWebRedisClient).mockReturnValue(new Promise(() => {}))

    const request = makeRequest(JSON.stringify({ 'csp-report': {} }), 'application/csp-report')

    const start = Date.now()
    const response = await handleCspReport(request)

    expect(response.status).toBe(204)
    expect(Date.now() - start).toBeLessThan(2000)
  })

  it('falls back to a shared bucket key when no trusted client IP is configured', async () => {
    vi.mocked(resolveTrustedClientIp).mockReturnValue(null)
    const incr = vi.fn().mockResolvedValue(1)
    vi.mocked(getWebRedisClient).mockResolvedValue({ incr, expire: vi.fn() } as never)

    await handleCspReport(
      makeRequest(JSON.stringify({ 'csp-report': {} }), 'application/csp-report')
    )

    expect(incr).toHaveBeenCalledWith(expect.stringContaining('unattributed'))
  })
})
