import { resolveTrustedWebPeers } from './trusted-web-peer'

describe('resolveTrustedWebPeers', () => {
  it('returns null when unset/empty (disabled, the safe default)', () => {
    expect(resolveTrustedWebPeers('')).toBeNull()
    expect(resolveTrustedWebPeers('   ')).toBeNull()
  })

  it('matches an exact IPv4 address', () => {
    const blockList = resolveTrustedWebPeers('172.20.0.5')!
    expect(blockList.check('172.20.0.5', 'ipv4')).toBe(true)
    expect(blockList.check('172.20.0.6', 'ipv4')).toBe(false)
  })

  it('matches an IPv4 CIDR range', () => {
    const blockList = resolveTrustedWebPeers('172.20.0.0/16')!
    expect(blockList.check('172.20.5.9', 'ipv4')).toBe(true)
    expect(blockList.check('172.21.0.1', 'ipv4')).toBe(false)
  })

  it('matches an IPv6 CIDR range', () => {
    const blockList = resolveTrustedWebPeers('2001:db8::/32')!
    expect(blockList.check('2001:db8::1', 'ipv6')).toBe(true)
    expect(blockList.check('2001:db9::1', 'ipv6')).toBe(false)
  })

  it('accepts a comma-separated list of entries', () => {
    const blockList = resolveTrustedWebPeers('172.20.0.0/16, 10.0.0.5')!
    expect(blockList.check('172.20.1.1', 'ipv4')).toBe(true)
    expect(blockList.check('10.0.0.5', 'ipv4')).toBe(true)
    expect(blockList.check('8.8.8.8', 'ipv4')).toBe(false)
  })

  it('expands the loopback preset (IPv4 and IPv6) — mirrors TRUST_PROXY', () => {
    const blockList = resolveTrustedWebPeers('loopback')!
    expect(blockList.check('127.0.0.1', 'ipv4')).toBe(true)
    expect(blockList.check('::1', 'ipv6')).toBe(true)
    expect(blockList.check('10.0.0.1', 'ipv4')).toBe(false)
  })

  it('expands the uniquelocal preset — covers the default docker-compose bridge subnet', () => {
    const blockList = resolveTrustedWebPeers('uniquelocal')!
    expect(blockList.check('172.17.0.5', 'ipv4')).toBe(true) // Docker's default bridge
    expect(blockList.check('10.1.2.3', 'ipv4')).toBe(true)
    expect(blockList.check('192.168.1.5', 'ipv4')).toBe(true)
    expect(blockList.check('8.8.8.8', 'ipv4')).toBe(false)
  })

  it('matches an IPv4-mapped IPv6 peer against an IPv4-added subnet', () => {
    const blockList = resolveTrustedWebPeers('127.0.0.1/8')!
    expect(blockList.check('::ffff:127.0.0.1', 'ipv6')).toBe(true)
  })

  it('rejects an unrecognized token — fails loudly on a typo', () => {
    expect(() => resolveTrustedWebPeers('loopbackk')).toThrow(/invalid entry/)
    expect(() => resolveTrustedWebPeers('not-an-ip')).toThrow(/invalid entry/)
    expect(() => resolveTrustedWebPeers('999.999.999.999')).toThrow(/invalid entry/)
    expect(() => resolveTrustedWebPeers('10.0.0.0/999')).toThrow(/invalid entry/)
  })

  it('accepts "/0" as syntactically valid, matching everything — same bound as TRUST_PROXY', () => {
    const blockList = resolveTrustedWebPeers('0.0.0.0/0')!
    expect(blockList.check('8.8.8.8', 'ipv4')).toBe(true)
  })
})
