/** Ordinary JSON/form ceiling in decoded bytes; multipart has independent file limits. */
export const REQUEST_BODY_LIMIT_BYTES = 100_000

export function isBackgroundControlPath(url: string, prefix: string): boolean {
  const path = url.split('?')[0] ?? ''
  const root = `${prefix}/admin/background-work/`
  return (
    path.startsWith(root) &&
    /^(?:commands(?:\/[^/]+\/reconciliation)?|works\/[^/]+\/jobs\/[^/]+\/reconciliation)\/?$/.test(
      path.slice(root.length)
    )
  )
}
