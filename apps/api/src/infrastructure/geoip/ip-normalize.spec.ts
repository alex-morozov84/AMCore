import { normalizeIpForGeoLookup } from './ip-normalize'

describe('normalizeIpForGeoLookup', () => {
  it.each(['fe80::1%eth0', 'fe80::1%3', '2001:4860:4860::8888%eth0'])(
    'excludes zone-scoped address %s without throwing',
    (ip) => {
      expect(normalizeIpForGeoLookup(ip)).toBeNull()
    }
  )
  it('normalizes an IPv4-mapped IPv6 public address before filtering', () => {
    expect(normalizeIpForGeoLookup('::ffff:8.8.8.8')).toBe('8.8.8.8')
  })

  it('still excludes an IPv4-mapped IPv6 loopback address', () => {
    expect(normalizeIpForGeoLookup('::ffff:127.0.0.1')).toBeNull()
  })

  it('resolves an ordinary public IPv4 address', () => {
    expect(normalizeIpForGeoLookup('203.0.0.1')).toBe('203.0.0.1')
  })

  it('excludes private IPv4 ranges', () => {
    expect(normalizeIpForGeoLookup('10.0.0.5')).toBeNull()
    expect(normalizeIpForGeoLookup('172.16.0.5')).toBeNull()
    expect(normalizeIpForGeoLookup('192.168.1.5')).toBeNull()
    expect(normalizeIpForGeoLookup('127.0.0.1')).toBeNull()
    expect(normalizeIpForGeoLookup('169.254.1.1')).toBeNull()
  })

  it('excludes documentation/benchmarking/multicast/reserved IPv4 ranges', () => {
    expect(normalizeIpForGeoLookup('192.0.2.1')).toBeNull()
    expect(normalizeIpForGeoLookup('198.51.100.1')).toBeNull()
    expect(normalizeIpForGeoLookup('203.0.113.1')).toBeNull()
    expect(normalizeIpForGeoLookup('224.0.0.1')).toBeNull()
    expect(normalizeIpForGeoLookup('255.255.255.255')).toBeNull()
  })

  it('resolves an ordinary public IPv6 address', () => {
    expect(normalizeIpForGeoLookup('2001:4860:4860::8888')).toBe('2001:4860:4860::8888')
  })

  it('excludes IPv6 loopback, unspecified, link-local and unique-local addresses', () => {
    expect(normalizeIpForGeoLookup('::1')).toBeNull()
    expect(normalizeIpForGeoLookup('::')).toBeNull()
    expect(normalizeIpForGeoLookup('fe80::1')).toBeNull()
    expect(normalizeIpForGeoLookup('fd00::1')).toBeNull()
  })

  it('returns null for absent input', () => {
    expect(normalizeIpForGeoLookup(null)).toBeNull()
    expect(normalizeIpForGeoLookup(undefined)).toBeNull()
    expect(normalizeIpForGeoLookup('')).toBeNull()
  })

  it('returns null for malformed input', () => {
    expect(normalizeIpForGeoLookup('not-an-ip')).toBeNull()
    expect(normalizeIpForGeoLookup('999.999.999.999')).toBeNull()
  })
})
