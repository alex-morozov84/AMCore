/** Preserve the entry point while changing only the related-list view. */
export function detailPageHref(
  base: string,
  page: number,
  returnTo?: string,
  search?: string
): string {
  const query = new URLSearchParams()
  if (search) query.set('search', search)
  if (page > 1) query.set('page', String(page))
  if (returnTo) query.set('returnTo', returnTo)
  const encoded = query.toString()
  return encoded ? `${base}?${encoded}` : base
}

export function parseDetailPage(raw: string | string[] | undefined): number {
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) return 1
  const page = Number(raw)
  return Number.isSafeInteger(page) && page <= 1_000_000 ? page : 1
}

export function parseDetailSearch(raw: string | string[] | undefined): string | undefined {
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  return trimmed && trimmed.length <= 255 ? trimmed : undefined
}
