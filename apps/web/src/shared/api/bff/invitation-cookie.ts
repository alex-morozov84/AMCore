import 'server-only'

export const INVITATION_OWNER_TTL_SECONDS = 86400
const HTTPS_COOKIE = '__Host-amcore_invite_browser'
const LOCAL_COOKIE = 'amcore_invite_browser_local'

type InvitationCookieEnvironment = {
  [key: string]: string | undefined
  WEB_INVITATION_LOCAL_HTTP_ORIGIN?: string
  WEB_TRUSTED_ORIGINS?: string
}

/** Explicit loopback exception; neither NODE_ENV nor an inbound forwarded host authorizes HTTP. */
export function invitationLocalOrigin(
  env: InvitationCookieEnvironment = process.env
): string | null {
  const value = env.WEB_INVITATION_LOCAL_HTTP_ORIGIN
  if (!value) return null
  const origin = new URL(value)
  const loopback =
    ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) ||
    /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+localhost$/.test(origin.hostname)
  const trusted = (env.WEB_TRUSTED_ORIGINS ?? 'http://localhost:3002')
    .split(',')
    .map((s) => s.trim())
  if (
    origin.protocol !== 'http:' ||
    value !== origin.origin ||
    !loopback ||
    !trusted.includes(value)
  )
    throw new Error(
      'WEB_INVITATION_LOCAL_HTTP_ORIGIN requires an exact trusted loopback HTTP origin'
    )
  return value
}

export function invitationCookiePolicy(
  requestUrl: string,
  env: InvitationCookieEnvironment = process.env
) {
  const origin = new URL(requestUrl).origin
  const localOrigin = invitationLocalOrigin(env)
  const secure = new URL(origin).protocol === 'https:'
  if (!secure && origin !== localOrigin) throw new Error('Invitation requests require HTTPS')
  return {
    origin,
    name: secure ? HTTPS_COOKIE : LOCAL_COOKIE,
    options: { secure, httpOnly: true, sameSite: 'lax' as const, path: '/' },
  }
}

/** Inspect the raw header: parsed cookie maps can hide duplicate proof values. */
export function readInvitationOwner(cookieHeader: string | null, name: string): string | null {
  const values = (cookieHeader ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.slice(0, part.indexOf('=')) === name)
    .map((part) => part.slice(part.indexOf('=') + 1))
  if (values.length === 0) return null
  if (values.length !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(values[0]!))
    throw new Error('Ambiguous or invalid invitation browser proof')
  return values[0]!
}

export function invitationOwnerMaxAge(expiresAt: number, now: number): number {
  return Math.max(0, Math.min(INVITATION_OWNER_TTL_SECONDS, Math.floor((expiresAt - now) / 1000)))
}
