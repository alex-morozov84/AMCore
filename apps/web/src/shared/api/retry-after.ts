/** Canonical bounded seconds from numeric delay or HTTP date; malformed values discarded. */
export function parseRetryAfterSeconds(headers: Headers): number | undefined {
  const raw = headers.get('Retry-After')?.trim()
  if (!raw) return undefined
  const delay = /^\d+(?:\.\d+)?$/.test(raw)
    ? Number(raw)
    : /^[A-Za-z]{3}, /.test(raw)
      ? (Date.parse(raw) - Date.now()) / 1000
      : NaN
  return Number.isFinite(delay) && delay >= 0 ? Math.min(86400, Math.ceil(delay)) : undefined
}
