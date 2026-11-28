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

function mockRedis(evaluate: ReturnType<typeof vi.fn>) {
  vi.mocked(getWebRedisClient).mockResolvedValue({
    isReady: true,
    withCommandOptions: () => ({ eval: evaluate }),
  } as never)
}

describe('handleCspReport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(resolveTrustedClientIp).mockReturnValue(null)
    mockRedis(vi.fn().mockResolvedValue(1))
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
    const evaluate = vi.fn().mockResolvedValue(21)
    mockRedis(evaluate)

    const request = makeRequest(JSON.stringify({ 'csp-report': {} }), 'application/csp-report')

    const response = await handleCspReport(request)

    expect(response.status).toBe(204)
    expect(evaluate).toHaveBeenCalledWith(expect.any(String), {
      keys: ['csp-report-rate-limit:203.0.113.7'],
      arguments: ['10'],
    })
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
    const connection = Promise.withResolvers<Awaited<ReturnType<typeof getWebRedisClient>>>()
    vi.mocked(getWebRedisClient).mockReturnValue(connection.promise)

    const request = makeRequest(JSON.stringify({ 'csp-report': {} }), 'application/csp-report')

    const start = Date.now()
    const response = await handleCspReport(request)

    expect(response.status).toBe(204)
    expect(Date.now() - start).toBeLessThan(2000)
    connection.reject(new Error('fixture connection closed'))
    await Promise.resolve()
  })

  it('falls back to a shared bucket key when no trusted client IP is configured', async () => {
    vi.mocked(resolveTrustedClientIp).mockReturnValue(null)
    const evaluate = vi.fn().mockResolvedValue(1)
    mockRedis(evaluate)

    await handleCspReport(
      makeRequest(JSON.stringify({ 'csp-report': {} }), 'application/csp-report')
    )

    expect(evaluate).toHaveBeenCalledWith(expect.any(String), {
      keys: ['csp-report-rate-limit:unattributed'],
      arguments: ['10'],
    })
  })

  it('holds the eight CSP slots until Redis settles even after the reports time out', async () => {
    const pending = Promise.withResolvers<number>()
    const evaluate = vi.fn().mockReturnValue(pending.promise)
    mockRedis(evaluate)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const report = () =>
      makeRequest(
        JSON.stringify({ 'csp-report': { 'violated-directive': 'script-src' } }),
        'application/csp-report'
      )
    try {
      const first = await Promise.all(Array.from({ length: 8 }, () => handleCspReport(report())))
      expect(first.every(({ status }) => status === 204)).toBe(true)
      expect(evaluate).toHaveBeenCalledTimes(8)
      expect(warn).toHaveBeenCalledTimes(8)
      expect((await handleCspReport(report())).status).toBe(204)
      expect(evaluate).toHaveBeenCalledTimes(8)
      expect(warn).toHaveBeenCalledTimes(8)
      pending.resolve(1)
      await pending.promise
      expect((await handleCspReport(report())).status).toBe(204)
      expect(evaluate).toHaveBeenCalledTimes(9)
    } finally {
      pending.resolve(1)
      warn.mockRestore()
    }
  })
})
