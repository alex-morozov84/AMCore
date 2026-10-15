export interface AnonymousResponse {
  status: number
  body: Buffer
}

/** One unauthenticated GET of an operator-configured address. */
export type AnonymousRead = (url: string, signal: AbortSignal) => Promise<AnonymousResponse>

/** A canary is a few dozen bytes; anything bigger is read no further. */
const MAX_BODY_BYTES = 4096

/**
 * Read a URL the way an anonymous browser would: no credentials, no cookies, no redirect
 * following (a redirect is reported as its own status, never silently followed to another
 * host), http(s) only, and a hard cap on the bytes read. The address comes from the
 * operator's configuration, never from a request.
 */
export const readAnonymously: AnonymousRead = async (url, signal) => {
  const target = new URL(url)
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new Error('Only http and https addresses can be checked')
  }
  const response = await fetch(target, {
    method: 'GET',
    redirect: 'manual',
    credentials: 'omit',
    signal,
  })
  const chunks: Buffer[] = []
  let size = 0
  const reader = response.body?.getReader()
  while (reader) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    chunks.push(Buffer.from(value))
    if (size > MAX_BODY_BYTES) {
      await reader.cancel()
      break
    }
  }
  return { status: response.status, body: Buffer.concat(chunks).subarray(0, MAX_BODY_BYTES) }
}

/** Injection token for the anonymous reader, so the check can be exercised without a network. */
export const ANONYMOUS_READ = Symbol('AnonymousRead')
