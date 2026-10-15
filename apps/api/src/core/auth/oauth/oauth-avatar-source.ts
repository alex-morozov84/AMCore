import { AVATAR_VALIDATION } from '@/infrastructure/storage'

/**
 * Hosts an OAuth profile picture may be downloaded from. Explicit and short on purpose: the
 * download is a server-side request to a URL that a third party supplied, so only the providers'
 * own image CDNs are allowed. Add a host here when a new provider returns a picture URL.
 */
const ALLOWED_HOST_SUFFIXES = ['.googleusercontent.com'] as const
const ALLOWED_HOSTS = ['avatars.githubusercontent.com'] as const

export const OAUTH_AVATAR_TIMEOUT_MS = 5000
export const OAUTH_AVATAR_MAX_BYTES = AVATAR_VALIDATION.maxSize
const ALLOWED_TYPES = new Set(AVATAR_VALIDATION.allowedMimeTypes)

export type OAuthAvatarFailure =
  'host_not_allowed' | 'request_failed' | 'redirect' | 'bad_status' | 'bad_type' | 'too_large'

export class OAuthAvatarError extends Error {
  constructor(readonly failure: OAuthAvatarFailure) {
    super(`oauth avatar download refused: ${failure}`)
    this.name = 'OAuthAvatarError'
  }
}

/** True only for an https URL on an allowed host, with no credentials and the default port. */
export function isAllowedAvatarSource(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false
  const host = url.hostname.toLowerCase()
  return (
    (ALLOWED_HOSTS as readonly string[]).includes(host) ||
    ALLOWED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
  )
}

/**
 * Download one profile picture. No redirect is followed (a redirect could leave the allow-list),
 * the wait is bounded and the body is read only up to the avatar size cap. The caller still sends
 * the bytes through the media pipeline, which checks the image content itself.
 */
export async function downloadAvatarSource(
  raw: string
): Promise<{ buffer: Buffer; mimetype: string }> {
  if (!isAllowedAvatarSource(raw)) throw new OAuthAvatarError('host_not_allowed')
  let response: Response
  try {
    response = await fetch(raw, {
      redirect: 'manual',
      signal: AbortSignal.timeout(OAUTH_AVATAR_TIMEOUT_MS),
    })
  } catch {
    throw new OAuthAvatarError('request_failed')
  }
  if (response.status >= 300 && response.status < 400) throw new OAuthAvatarError('redirect')
  if (!response.ok || !response.body) throw new OAuthAvatarError('bad_status')
  const mimetype = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
  if (!ALLOWED_TYPES.has(mimetype)) throw new OAuthAvatarError('bad_type')
  return { buffer: await readCapped(response.body), mimetype }
}

async function readCapped(body: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = []
  let size = 0
  const reader = body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > OAUTH_AVATAR_MAX_BYTES) throw new OAuthAvatarError('too_large')
      chunks.push(value)
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error instanceof OAuthAvatarError ? error : new OAuthAvatarError('request_failed')
  }
  return Buffer.concat(chunks)
}
