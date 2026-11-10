// Exact-version patches require manual review even for patch/minor updates.
function publishedVersion(run, selector) {
  const result = run('pnpm', ['view', selector, 'version', '--json'], 20000)
  try {
    const data = result.ok ? JSON.parse(result.out) : null
    const versions = (Array.isArray(data) ? data : [data])
      .filter((value) => typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value))
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    return versions.at(-1) ?? null
  } catch {
    return null
  }
}

export function nextFreshness(run, workspace) {
  const current = workspace.match(/^\s+next@(\d+\.\d+\.\d+):/m)?.[1]
  const latest = publishedVersion(run, 'next@latest')
  const sameMajor = current ? publishedVersion(run, `next@${current.split('.')[0]}`) : null
  return [
    '## Next.js manual update (all release sizes)',
    '',
    '| Patched version | Newest stable in current major | Stable registry latest | Status / next action |',
    '|---|---|---|---|',
    `| ${current ?? 'unknown'} | ${sameMajor ?? 'unavailable'} | ${latest ?? 'unavailable'} | ${!current || !latest || !sameMajor ? 'Unknown: check patch registration or registry access.' : current === latest && current === sameMajor ? 'Matches registry latest; retain the patch until the upstream fix is verified.' : 'Different release available; manually review the release and exact-version patch before updating.'} |`,
    '',
    'Includes patch/minor releases. Dependabot and lockfile refresh leave Next.js for manual review while the exact-version patch is retained.',
    'Check https://github.com/vercel/next.js/pull/96737 and docs/frontend/next-route-cache-patch.md. Remove the patch only after an official fixed release passes the documented production URL/content checks without it.',
    '',
  ]
}
