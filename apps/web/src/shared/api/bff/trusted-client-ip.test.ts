// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveTrustedClientIp } from './trusted-client-ip'

vi.mock('server-only', () => ({}))

describe('resolveTrustedClientIp', () => {
  afterEach(() => {
    delete process.env.WEB_TRUSTED_CLIENT_IP_HEADER
  })

  it('returns null when disabled (default) — even if the header is present', () => {
    const headers = new Headers({ 'x-real-ip': '203.0.113.7' })
    expect(resolveTrustedClientIp(headers)).toBeNull()
  })

  it('returns the header value once enabled for a recognized header', () => {
    process.env.WEB_TRUSTED_CLIENT_IP_HEADER = 'x-real-ip'
    const headers = new Headers({ 'x-real-ip': '203.0.113.7' })
    expect(resolveTrustedClientIp(headers)).toBe('203.0.113.7')
  })

  it('returns null when the configured header is absent from the request', () => {
    process.env.WEB_TRUSTED_CLIENT_IP_HEADER = 'x-real-ip'
    expect(resolveTrustedClientIp(new Headers())).toBeNull()
  })

  it('takes the first entry of a comma-separated X-Forwarded-For chain', () => {
    process.env.WEB_TRUSTED_CLIENT_IP_HEADER = 'x-forwarded-for'
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.5' })
    expect(resolveTrustedClientIp(headers)).toBe('203.0.113.7')
  })

  it('returns null for a malformed (non-IP) header value — fails safe, not loud', () => {
    process.env.WEB_TRUSTED_CLIENT_IP_HEADER = 'x-real-ip'
    const headers = new Headers({ 'x-real-ip': 'not-an-ip' })
    expect(resolveTrustedClientIp(headers)).toBeNull()
  })

  it('throws on an unrecognized configured header name — fails loudly on misconfiguration', () => {
    process.env.WEB_TRUSTED_CLIENT_IP_HEADER = 'x-made-up-header'
    expect(() => resolveTrustedClientIp(new Headers())).toThrow(/unsupported header/)
  })

  it('accepts every documented header name', () => {
    for (const header of [
      'x-real-ip',
      'x-forwarded-for',
      'cf-connecting-ip',
      'true-client-ip',
      'fastly-client-ip',
    ]) {
      process.env.WEB_TRUSTED_CLIENT_IP_HEADER = header
      const headers = new Headers({ [header]: '203.0.113.7' })
      expect(resolveTrustedClientIp(headers)).toBe('203.0.113.7')
    }
  })
})
