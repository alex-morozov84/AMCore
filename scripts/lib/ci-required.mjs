export const requiredCiJobs = Object.freeze([
  'lint',
  'typecheck',
  'build',
  'test-unit-redis',
  'test-capability',
  'test-notification-ai',
  'test',
  'api-e2e-plan',
  'api-e2e-shards',
  'api-e2e',
  'script-contracts',
  'docker-image-smoke',
  'web-e2e-plan',
  'web-e2e-lanes',
  'web-e2e',
  'promtool',
  'observability-contract-live',
  'storybook',
])

/** Initial admission keeps every existing job mandatory; selection is not activated here. */
export function requireCompleteCi(results) {
  if (!results || typeof results !== 'object' || Array.isArray(results))
    throw new Error('CI dependency results must be an object')
  const actual = Object.keys(results)
  if (
    actual.length !== requiredCiJobs.length ||
    actual.some((name) => !requiredCiJobs.includes(name))
  )
    throw new Error('CI dependency inventory differs from the required jobs')
  const incomplete = requiredCiJobs.filter((name) => results[name]?.result !== 'success')
  if (incomplete.length)
    throw new Error(`Required CI jobs did not succeed: ${incomplete.join(', ')}`)
}
