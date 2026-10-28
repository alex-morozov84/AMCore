/** Budgets/redaction only. Never use this folded reading to rewrite routing or dynamic identifiers. */
export function mfaCredentialPath(url: string, prefix?: string): boolean {
  let path = url.split('?')[0] ?? ''
  for (let pass = 0; pass < 4; pass += 1) {
    const folded = path.replace(/%([a-f0-9]{2})/gi, (encoded, hex: string) => {
      const char = String.fromCharCode(Number.parseInt(hex, 16))
      return /^[A-Za-z0-9._~%/\\-]$/.test(char) ? char : encoded
    })
    if (folded === path) break
    path = folded
  }
  const segments: string[] = []
  for (const part of path.replaceAll('\\', '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') segments.pop()
    else segments.push(part)
  }
  const normalized = `/${segments.join('/')}`.toLowerCase()
  const folded = path.replaceAll('\\', '/').replace(/\/+/g, '/').toLowerCase()
  return [folded, normalized].some((reading) => {
    if (prefix === undefined)
      return /(?:^|\/)auth\/(?:login|mfa|browser-publications|oauth\/exchange)(?:\/|$)/.test(
        reading
      )
    const root = prefix.replace(/\/$/, '').toLowerCase()
    return (
      reading.startsWith(`${root}/`) &&
      /^\/auth\/(?:login|mfa|browser-publications|oauth\/exchange)(?:\/|$)/.test(
        reading.slice(root.length)
      )
    )
  })
}
