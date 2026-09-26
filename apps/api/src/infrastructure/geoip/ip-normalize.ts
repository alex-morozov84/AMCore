import { BlockList, isIP } from 'node:net'

const IPV4_MAPPED_PREFIX = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i

function toEmbeddedIpv4(ip: string): string | null {
  const match = IPV4_MAPPED_PREFIX.exec(ip)
  return match ? match[1]! : null
}

/** Private, loopback, link-local, CGNAT, benchmarking/documentation, multicast and reserved IPv4 ranges. */
function isPrivateOrReservedIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a, b, c] = parts as [number, number, number, number]
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT (RFC 6598)
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true // IETF protocol assignments / TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true // benchmarking (RFC 2544)
  if (a === 198 && b === 51 && c === 100) return true // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true // TEST-NET-3
  if (a >= 224) return true // multicast (224-239) + reserved/broadcast (240-255)
  return false
}

/** Loopback, unspecified, link-local and unique-local (fc00::/7) IPv6 ranges. */
const excludedIpv6 = new BlockList()
for (const [address, prefix] of [
  ['::', 96],
  ['::1', 128],
  ['fe80::', 10],
  ['fc00::', 7],
  ['ff00::', 8],
  ['2001:db8::', 32],
  ['100::', 64],
] as const)
  excludedIpv6.addSubnet(address, prefix, 'ipv6')

function isPrivateOrReservedIpv6(ip: string): boolean {
  return excludedIpv6.check(ip, 'ipv6')
}

/**
 * Resolves the address to look up in the GeoIP database, or `null` if the
 * caller must not attempt a lookup (private/reserved/malformed input).
 *
 * An IPv4-mapped IPv6 address (`::ffff:a.b.c.d`) is normalized to its
 * embedded IPv4 form **before** the private/reserved filter runs (RFC 4291
 * §2.5.5.2) — filtering the mapped form directly would wrongly exclude a
 * legitimate public IPv4 address stored in that shape. A
 * mapped public address (`::ffff:8.8.8.8`) therefore resolves as ordinary
 * public `8.8.8.8`; a mapped loopback (`::ffff:127.0.0.1`) is still
 * correctly excluded.
 */
export function normalizeIpForGeoLookup(ip: string | null | undefined): string | null {
  if (!ip || isIP(ip) === 0) return null
  if (isIP(ip) === 6) {
    const canonical = new URL(`http://[${ip}]`).hostname.slice(1, -1)
    const hex = /^::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})$/i.exec(canonical)
    if (hex) {
      const high = parseInt(hex[1]!, 16),
        low = parseInt(hex[2]!, 16)
      ip = `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`
    }
  }
  const embedded = toEmbeddedIpv4(ip)
  if (embedded !== null) return isPrivateOrReservedIpv4(embedded) ? null : embedded
  if (ip.includes(':')) return isPrivateOrReservedIpv6(ip) ? null : ip
  return isPrivateOrReservedIpv4(ip) ? null : ip
}
