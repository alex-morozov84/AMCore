import type { Page } from '@playwright/test'

/** Bounded route/status diagnostics; never retain bodies, identifiers or credentials. */
export function observeContextReads(page: Page) {
  const reads: Array<{ route: string; status: number; errorCode?: string; retryAfter?: string }> =
    []
  const pending = new Set<Promise<void>>()
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname
    if (response.request().method() !== 'GET' || !path.startsWith('/api/product-access/')) return
    const read = (async () => {
      const body = response.ok() ? undefined : await response.json().catch(() => undefined)
      reads.push({
        route:
          path === '/api/product-access/bootstrap'
            ? path
            : path.endsWith('/invites')
              ? '/api/product-access/organizations/<id>/invites'
              : '/api/product-access/<resource>',
        status: response.status(),
        errorCode:
          typeof body?.errorCode === 'string' && /^[A-Z_]{1,64}$/.test(body.errorCode)
            ? body.errorCode
            : undefined,
        retryAfter: /^\d{1,6}$/.test(response.headers()['retry-after'] ?? '')
          ? response.headers()['retry-after']
          : undefined,
      })
      if (reads.length > 16) reads.shift()
    })()
    pending.add(read)
    void read.finally(() => pending.delete(read))
  })
  return async () => {
    await Promise.all(pending)
    return [...reads]
  }
}
