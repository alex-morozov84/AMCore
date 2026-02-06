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
  })

  it('should return undefined for invalid IP', () => {
    expect(anonymizeIp('not-an-ip')).toBeUndefined()
    expect(anonymizeIp('192.168')).toBeUndefined()
  })

  it('should return undefined for undefined input', () => {
    expect(anonymizeIp(undefined)).toBeUndefined()
  })
})

describe('getClientIp', () => {
  it('should extract IP from X-Real-IP header', () => {
    const req = {
      headers: { 'x-real-ip': '192.168.1.100' },
    }
    expect(getClientIp(req)).toBe('192.168.1.100')
  })

  it('should extract first IP from X-Forwarded-For', () => {
    const req = {
      headers: { 'x-forwarded-for': '192.168.1.100, 10.0.0.1, 172.16.0.1' },
    }
    expect(getClientIp(req)).toBe('192.168.1.100')
  })

  it('should prioritize X-Real-IP over X-Forwarded-For', () => {
    const req = {
      headers: {
        'x-real-ip': '192.168.1.100',
        'x-forwarded-for': '10.0.0.1',
      },
    }
    expect(getClientIp(req)).toBe('192.168.1.100')
  })

  it('should fallback to req.ip', () => {
    const req = {
      headers: {},
      ip: '192.168.1.100',
    }
    expect(getClientIp(req)).toBe('192.168.1.100')
  })

  it('should fallback to req.socket.remoteAddress', () => {
    const req = {
      headers: {},
      socket: { remoteAddress: '192.168.1.100' },
    }
    expect(getClientIp(req)).toBe('192.168.1.100')
  })

  it('should return undefined if no IP found', () => {
    const req = {
      headers: {},
    }
    expect(getClientIp(req)).toBeUndefined()
  })
})
