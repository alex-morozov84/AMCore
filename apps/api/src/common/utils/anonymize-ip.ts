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

  // IPv4
  if (ip.includes('.')) {
    const parts = ip.split('.')
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.0.0`
    }
  }

  // IPv6 - keep only first segment (16 bits)
  if (ip.includes(':')) {
    const firstSegment = ip.split(':')[0]
    if (firstSegment) {
      return `${firstSegment}::`
    }
  }

  return undefined
}

interface RequestWithIp {
  headers: Record<string, string | string[] | undefined>
  ip?: string
  socket?: {
    remoteAddress?: string
  }
}

/**
 * Extracts real client IP from request headers (handles proxies/load balancers)
 *
 * Priority:
 * 1. X-Real-IP (Nginx)
 * 2. X-Forwarded-For (first IP in chain)
 * 3. req.ip
 * 4. req.socket.remoteAddress
 *
 * @param req - Express Request object
 * @returns Client IP address
 */
export function getClientIp(req: RequestWithIp): string | undefined {
  // X-Real-IP from Nginx
  const realIp = req.headers['x-real-ip']
  if (realIp) return realIp as string

  // X-Forwarded-For (take first IP from chain)
  const forwardedFor = req.headers['x-forwarded-for']
  if (forwardedFor) {
    const ips = forwardedFor.toString().split(',')
    const firstIp = ips[0]
    if (firstIp) {
      return firstIp.trim()
    }
  }

  // Fallback to direct connection IP
  return req.ip || req.socket?.remoteAddress
}
