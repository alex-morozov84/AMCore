import { resolveTrustProxy } from './trust-proxy'

describe('resolveTrustProxy', () => {
  it('defaults to false (empty / "false", case-insensitive)', () => {
    expect(resolveTrustProxy('')).toBe(false)
    expect(resolveTrustProxy('false')).toBe(false)
    expect(resolveTrustProxy('  FALSE  ')).toBe(false)
  })

  it('accepts true', () => {
    expect(resolveTrustProxy('true')).toBe(true)
    expect(resolveTrustProxy('TRUE')).toBe(true)
  })

  it('accepts a hop count as a number', () => {
    expect(resolveTrustProxy('1')).toBe(1)
    expect(resolveTrustProxy('3')).toBe(3)
  })

  it('accepts named presets (normalizing case to Express form)', () => {
    expect(resolveTrustProxy('loopback')).toBe('loopback')
    expect(resolveTrustProxy('linklocal')).toBe('linklocal')
    expect(resolveTrustProxy('uniquelocal')).toBe('uniquelocal')
    expect(resolveTrustProxy('LOOPBACK')).toBe('loopback')
  })

  it('accepts a comma-separated list of presets / IPs / CIDRs (normalizing spacing)', () => {
    expect(resolveTrustProxy('loopback, 10.0.0.0/8')).toBe('loopback,10.0.0.0/8')
    expect(resolveTrustProxy('127.0.0.1,::1')).toBe('127.0.0.1,::1')
    expect(resolveTrustProxy('2001:db8::/32')).toBe('2001:db8::/32')
  })

  it('rejects invalid presets, IPs, and CIDR prefixes (Express would silently mis-parse)', () => {
    expect(() => resolveTrustProxy('looback')).toThrow(/invalid entry/)
    expect(() => resolveTrustProxy('loopback, not@an-ip')).toThrow(/invalid entry/)
    expect(() => resolveTrustProxy('10.0.0.0/8,')).toThrow(/invalid entry/)
    expect(() => resolveTrustProxy('999.999.999.999')).toThrow(/invalid entry/)
    expect(() => resolveTrustProxy('10.0.0.0/999')).toThrow(/invalid entry/)
    expect(() => resolveTrustProxy('::::')).toThrow(/invalid entry/)
  })
})
