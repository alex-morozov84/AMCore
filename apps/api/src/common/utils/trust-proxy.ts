import { isIP } from 'node:net'

// Resolve the Express `trust proxy` setting from the TRUST_PROXY env string.
//
// Default `false` — trust no proxy, so `req.ip` is the socket peer and
// `X-Forwarded-*` is never believed (not spoofable). Configure it to match the real
// proxy topology so Express strips untrusted `X-Forwarded-For` hops and `req.ip`
// becomes the true client:
//   false            trust no proxy (default; app directly exposed)
//   <n>              trust n hops closest to the app
//   loopback         trust localhost proxies (also: linklocal, uniquelocal)
//   <ip/cidr>[,...]  trust these proxy addresses/subnets (e.g. the Docker network)
// Broad `true` trusts the left-most forwarded entry and is only safe when the app is
// unreachable except through a trusted, header-sanitizing proxy.
//
// Entries are validated here (real IP/CIDR checks, known presets) so a typo fails at
// boot with a clear message rather than being silently mis-parsed by Express later.
const PRESETS = new Set(['loopback', 'linklocal', 'uniquelocal'])

function invalidEntry(token: string): Error {
  return new Error(
    `TRUST_PROXY: invalid entry "${token}" — expected false/true, a hop count, or a ` +
      `comma-separated list of loopback/linklocal/uniquelocal or IP/CIDR addresses`
  )
}

// Returns the normalized token (presets lower-cased, as Express expects) or throws.
function normalizeToken(token: string): string {
  const lower = token.toLowerCase()
  if (PRESETS.has(lower)) return lower

  const slash = token.indexOf('/')
  const address = slash === -1 ? token : token.slice(0, slash)
  const version = isIP(address) // 0 = invalid, else 4 or 6
  if (version === 0) throw invalidEntry(token)
  if (slash === -1) return token

  const prefix = token.slice(slash + 1)
  const max = version === 4 ? 32 : 128
  if (!/^\d{1,3}$/.test(prefix) || Number(prefix) > max) throw invalidEntry(token)
  return token
}

export function resolveTrustProxy(raw: string): boolean | number | string {
  const value = raw.trim()
  if (value === '' || value.toLowerCase() === 'false') return false
  if (value.toLowerCase() === 'true') return true
  if (/^\d+$/.test(value)) return Number(value)

  return value
    .split(',')
    .map((token) => normalizeToken(token.trim()))
    .join(',')
}
