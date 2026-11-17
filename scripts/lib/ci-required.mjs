import { selectCiGroups } from './ci-selection.mjs'

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

/** Broad bridge admits the selector but never uses its proposed exclusions as permission. */
export function requireBridgeCi(results, plan, identity) {
  if (!results || results['ci-selection']?.result !== 'success')
    throw new Error('CI selector did not succeed')
  const shape = selectCiGroups({
    role: 'upstream-starter',
    mode: 'normal',
    diffComplete: false,
    areas: {},
  })
  const proposed = plan?.proposed
  const invalid =
    !proposed ||
    Array.isArray(proposed) ||
    Object.keys(proposed).length !== Object.keys(shape).length ||
    Object.entries(shape).some(([key, value]) => {
      const actual = proposed[key]
      if (Array.isArray(value))
        return (
          !Array.isArray(actual) ||
          new Set(actual).size !== actual.length ||
          actual.some((item) => !['api', 'web', 'shared'].includes(item))
        )
      return (
        typeof actual !== typeof value ||
        (typeof value === 'string' &&
          !{
            quality: ['code', 'docs'],
            web: ['none', 'ui', 'runtime'],
            monitoring: ['static', 'live'],
          }[key]?.includes(actual))
      )
    })
  if (
    invalid ||
    Object.keys(plan).length !== 9 ||
    !/^[\w.-]+\/[\w.-]+$/.test(identity.repository ?? '') ||
    !plan ||
    plan.version !== 1 ||
    plan.phase !== 'broad' ||
    plan.run !== identity.run ||
    plan.attempt !== identity.attempt ||
    !/^\d+$/.test(identity.run ?? '') ||
    !/^[1-9]\d*$/.test(identity.attempt ?? '') ||
    plan.repository !== identity.repository ||
    plan.event !== identity.event ||
    plan.source?.head !== identity.source.head ||
    plan.source?.base !== identity.source.base ||
    JSON.stringify(plan.effective) !== JSON.stringify(requiredCiJobs) ||
    !plan.proposed ||
    typeof plan.proposed !== 'object' ||
    Array.isArray(plan.proposed)
  )
    throw new Error('Invalid broad CI execution plan or source identity')
  const families = { ...results }
  delete families['ci-selection']
  requireCompleteCi(families)
}
