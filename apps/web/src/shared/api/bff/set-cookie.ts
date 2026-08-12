import 'server-only'

/**
 * Extracts one cookie's value from a `fetch` `Response`'s `Set-Cookie`
 * header(s) — shared by `upstream-auth.ts` (login/register) and
 * `upstream-refresh.ts` (`/auth/refresh`), both of which need the raw
 * `refresh_token` value to store in the vault rather than ever forwarding
 * the cookie itself to the browser (ADR-068).
 */
export function extractCookieValue(response: Response, name: string): string | null {
  const setCookieHeaders =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter((value): value is string => value !== null)

  for (const header of setCookieHeaders) {
    const [pair] = header.split(';')
    const separatorIndex = pair?.indexOf('=') ?? -1
    if (separatorIndex <= 0) continue

    const cookieName = pair!.slice(0, separatorIndex).trim()
    const cookieValue = pair!.slice(separatorIndex + 1).trim()
    if (cookieName === name && cookieValue) return cookieValue
  }

  return null
}
