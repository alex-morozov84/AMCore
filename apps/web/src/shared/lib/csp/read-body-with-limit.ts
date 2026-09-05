import 'server-only'

/**
 * Reads a `Request` body up to `maxBytes`, returning `null` if it's larger
 * — checking the actual bytes read, not just trusting `Content-Length`
 * (which an attacker can omit or lie about). Used by the CSP reporting
 * endpoint (Track 3 PR3, FINAL PLAN §3 — "enforce a small request body
 * limit"), a public unauthenticated route where this matters.
 */
export async function readBodyWithLimit(
  request: Request,
  maxBytes: number
): Promise<string | null> {
  const contentLength = Number(request.headers.get('content-length') ?? '0')
  if (contentLength > maxBytes) return null

  const reader = request.body?.getReader()
  if (!reader) return ''

  const decoder = new TextDecoder()
  let totalBytes = 0
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    totalBytes += value.byteLength
    if (totalBytes > maxBytes) {
      await reader.cancel()
      return null
    }
    text += decoder.decode(value, { stream: true })
  }
  text += decoder.decode()
  return text
}
