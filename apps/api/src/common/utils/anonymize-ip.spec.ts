import { anonymizeIp, getClientIp } from './anonymize-ip'

describe('anonymizeIp', () => {
  it('should anonymize IPv4 address', () => {
    expect(anonymizeIp('192.168.1.100')).toBe('192.168.0.0')
    expect(anonymizeIp('10.0.5.123')).toBe('10.0.0.0')
    expect(anonymizeIp('172.16.254.1')).toBe('172.16.0.0')
  })

  it('should anonymize IPv6 address', () => {
    expect(anonymizeIp('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe('2001::')
    expect(anonymizeIp('2001:db8::1')).toBe('2001::')
    expect(anonymizeIp('fe80::1')).toBe('fe80::')
    expect(anonymizeIp('::1')).toBe('0::')
    expect(anonymizeIp('::ffff:192.168.1.100')).toBe('0::')
  })

  it('should return undefined for invalid IP', () => {
    expect(anonymizeIp('not-an-ip')).toBeUndefined()
    expect(anonymizeIp('192.168')).toBeUndefined()
    expect(anonymizeIp('999.999.999.999')).toBeUndefined()
    expect(anonymizeIp('::ffff:999.999.999.999')).toBeUndefined()
  })

  it('should return undefined for undefined input', () => {
    expect(anonymizeIp(undefined)).toBeUndefined()
  })
})

describe('getClientIp', () => {
  it("uses Express's req.ip (trust-proxy-aware)", () => {
    expect(getClientIp({ ip: '192.168.1.100' })).toBe('192.168.1.100')
  })

  it('falls back to req.socket.remoteAddress when req.ip is unset', () => {
    expect(getClientIp({ socket: { remoteAddress: '192.168.1.100' } })).toBe('192.168.1.100')
  })

  it('never trusts client-controlled forwarded headers (spoofing)', () => {
    // With trust proxy off, Express leaves req.ip as the socket peer regardless of
    // any X-Forwarded-For / X-Real-IP the caller sent — so a spoofed header cannot
    // change the recorded IP.
    const spoofed = {
      headers: { 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '5.6.7.8' },
      ip: '10.0.0.9',
      socket: { remoteAddress: '10.0.0.9' },
    } as unknown as { ip?: string; socket?: { remoteAddress?: string } }
    expect(getClientIp(spoofed)).toBe('10.0.0.9')
  })

  it('returns undefined if no IP is available', () => {
    expect(getClientIp({})).toBeUndefined()
  })
})
