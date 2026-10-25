import 'server-only'

/** Device metadata only. The backend transport owns the visitor-IP claim. */
export function sessionMetadataHeaders(source: Headers): Record<string, string> {
  return { 'User-Agent': source.get('user-agent') ?? '' }
}
