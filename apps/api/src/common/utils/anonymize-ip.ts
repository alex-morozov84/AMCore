import { isIP } from 'node:net'

/**
 * Anonymizes IP address for GDPR compliance
 *
 * IPv4: 192.168.1.100 → 192.168.0.0 (keeps first 2 octets)
 * IPv6: 2001:0db8:85a3::7334 → 2001:: (keeps first segment only)
 *
 * @param ip - IP address to anonymize
 * @returns Anonymized IP address
 */
export function anonymizeIp(ip: string | undefined): string | undefined {
  if (!ip) return undefined

  const version = isIP(ip)
  if (version === 0) return undefined

  // IPv4
  if (version === 4) {
    const parts = ip.split('.')
    return `${parts[0]}.${parts[1]}.0.0`
  }

  // IPv6 - keep only first segment (16 bits)
  const firstHextet = ip.startsWith('::') ? '0' : ip.split(':')[0]
  if (firstHextet) return `${firstHextet}::`

  return undefined
}

interface RequestWithIp {
  ip?: string
  socket?: {
    remoteAddress?: string
  }
}

/**
 * Resolves the client IP for audit/logging.
 *
 * Uses Express's computed `req.ip`, which honors the `trust proxy` setting
 * (TRUST_PROXY): with it off, `req.ip` is the socket peer; with it configured, the
 * real client with untrusted `X-Forwarded-*` hops stripped. `X-Forwarded-For` /
 * `X-Real-IP` are NEVER read directly — they are client-controlled and would let a
 * caller spoof the recorded IP. Configure TRUST_PROXY to your proxy topology to get
 * true client IPs behind a reverse proxy.
 *
 * @param req - Express Request object
 * @returns Client IP address
 */
export function getClientIp(req: RequestWithIp): string | undefined {
  return req.ip ?? req.socket?.remoteAddress
}
