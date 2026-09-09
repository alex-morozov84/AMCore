// @vitest-environment node
import { headers } from 'next/headers'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveTrustedClientIp } from '../bff/trusted-client-ip'

import { resolveAuthHeader } from './auth-header'
import { buildOutboundHeaders } from './outbound-headers'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ headers: vi.fn() }))
vi.mock('./auth-header', () => ({ resolveAuthHeader: vi.fn() }))
vi.mock('../bff/trusted-client-ip', () => ({ resolveTrustedClientIp: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(headers).mockResolvedValue(new Headers() as never)
  vi.mocked(resolveTrustedClientIp).mockReturnValue(null)
  vi.mocked(resolveAuthHeader).mockResolvedValue({})
})

describe('buildOutboundHeaders', () => {
  it('always sets Content-Type and the correlation id', async () => {
    const result = await buildOutboundHeaders('corr-1', 'none')

    expect('headers' in result && result.headers.get('Content-Type')).toBe('application/json')
    expect('headers' in result && result.headers.get('X-Correlation-Id')).toBe('corr-1')
  })

  it('reports authUnavailable and builds no headers when auth resolution is unavailable', async () => {
    vi.mocked(resolveAuthHeader).mockResolvedValue({ unavailable: true })

    expect(await buildOutboundHeaders('corr-1', 'optional')).toEqual({ authUnavailable: true })
  })

  it('sets Authorization when resolveAuthHeader returns one', async () => {
    vi.mocked(resolveAuthHeader).mockResolvedValue({ header: 'Bearer at-1' })

    const result = await buildOutboundHeaders('corr-1', 'optional')

    expect('headers' in result && result.headers.get('Authorization')).toBe('Bearer at-1')
  })

  it('omits Authorization when resolveAuthHeader returns none', async () => {
    const result = await buildOutboundHeaders('corr-1', 'none')

    expect('headers' in result && result.headers.has('Authorization')).toBe(false)
  })

  it('relays the trusted client IP header when resolved', async () => {
    vi.mocked(resolveTrustedClientIp).mockReturnValue('203.0.113.9')

    const result = await buildOutboundHeaders('corr-1', 'none')

    expect('headers' in result && result.headers.get('x-amcore-client-ip')).toBe('203.0.113.9')
  })
})
