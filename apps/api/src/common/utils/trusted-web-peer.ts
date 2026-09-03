import { BlockList, isIP } from 'node:net'

// Which real socket peers apps/api trusts to relay a verified client-IP claim
// (AMCORE_CLIENT_IP_HEADER, ADR-072) via the apps/web BFF hop. Unlike
// TRUST_PROXY (ADR-060), this never touches Express's own trust-proxy/req.ip
// machinery — it checks the literal TCP peer address of the inbound request
// (`req.socket.remoteAddress`, never a forwarded header) against an explicit
// allowlist, using Node's built-in `net.BlockList` for real IPv4/IPv6 CIDR
// matching (no new dependency; matches ADR-060's precedent of bespoke code
// over a reused parser like `proxy-addr`). Default unset = disabled: the
// header is never trusted from any peer until an operator opts in.
//
// Preset names mirror TRUST_PROXY's own presets for naming consistency.
const PRESET_RANGES: Record<string, Array<[address: string, prefix: number, family: 4 | 6]>> = {
  loopback: [
    ['127.0.0.1', 8, 4],
    ['::1', 128, 6],
  ],
  linklocal: [
    ['169.254.0.0', 16, 4],
    ['fe80::', 10, 6],
  ],
  uniquelocal: [
    ['10.0.0.0', 8, 4],
    ['172.16.0.0', 12, 4],
    ['192.168.0.0', 16, 4],
    ['fc00::', 7, 6],
  ],
}

function invalidEntry(token: string): Error {
  return new Error(
    `TRUSTED_WEB_PEERS: invalid entry "${token}" - expected loopback/linklocal/uniquelocal ` +
      `or an IP/CIDR address`
  )
}

function addPreset(blockList: BlockList, name: string): void {
  for (const [address, prefix, version] of PRESET_RANGES[name]!) {
    blockList.addSubnet(address, prefix, version === 4 ? 'ipv4' : 'ipv6')
  }
}

function addAddress(blockList: BlockList, token: string): void {
  const slash = token.indexOf('/')
  const address = slash === -1 ? token : token.slice(0, slash)
  const version = isIP(address)
  if (version === 0) throw invalidEntry(token)

  const max = version === 4 ? 32 : 128
  const prefixText = slash === -1 ? String(max) : token.slice(slash + 1)
  if (!/^\d{1,3}$/.test(prefixText)) throw invalidEntry(token)
  // Same bound as TRUST_PROXY's own validator (trust-proxy.ts): only the
  // upper bound is checked. A "/0" is syntactically valid (matches
  // everything) — this validator checks format, not policy wisdom.
  const prefix = Number(prefixText)
  if (prefix > max) throw invalidEntry(token)

  blockList.addSubnet(address, prefix, version === 4 ? 'ipv4' : 'ipv6')
}

/**
 * Parses `TRUSTED_WEB_PEERS` into a `net.BlockList` for verifying an inbound
 * request's *actual* socket peer is a trusted apps/web hop, before the
 * throttler guard trusts `AMCORE_CLIENT_IP_HEADER` (ADR-072). Returns `null`
 * when unset/empty — disabled, the safe default under which the header is
 * never trusted regardless of value. Throws on an unrecognized token, the
 * same fail-loudly-on-typo discipline `TRUST_PROXY` uses (ADR-060).
 */
export function resolveTrustedWebPeers(raw: string): BlockList | null {
  const value = raw.trim()
  if (!value) return null

  const blockList = new BlockList()
  for (const rawToken of value.split(',')) {
    const token = rawToken.trim()
    const lower = token.toLowerCase()
    if (PRESET_RANGES[lower]) {
      addPreset(blockList, lower)
    } else {
      addAddress(blockList, token)
    }
  }
  return blockList
}
