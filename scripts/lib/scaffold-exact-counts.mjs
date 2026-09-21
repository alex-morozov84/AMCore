export function assertExactScaffoldCounts(counts) {
  const stale = counts.filter(({ expected, actual }) => expected !== actual)
  if (!stale.length) return
  const report = stale
    .map(({ name, expected, actual }) => `- ${name}: ${expected} -> ${actual}`)
    .join('\n')
  throw new Error(`stale scaffold exact counts:\n${report}`)
}
