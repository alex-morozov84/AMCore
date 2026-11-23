import { selectCiGroups } from './ci-selection.mjs'

export const requiredCiJobs = Object.freeze([
  'lint',
  'typecheck',
  'build',
  'test-unit',
  'test-redis',
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
  'test-email',
  'deployment-version',
])

/** Retained broad-inventory assertion for the original all-success contract. */
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

/** Translate policy groups into the jobs that actually exist. */
export function coarseExecution(inputs) {
  const proposed = selectCiGroups(inputs)
  const web = proposed.web !== 'none'
  const selected = {
    lint: true,
    typecheck: true,
    promtool: true,
    build: proposed.build,
    'test-unit': proposed.unit,
    'test-redis': proposed.redis,
    'test-capability': proposed.capability,
    'test-notification-ai': proposed.notification,
    test:
      proposed.unit ||
      proposed.redis ||
      proposed.capability ||
      proposed.notification ||
      proposed.api,
    'api-e2e-plan': proposed.api,
    'api-e2e-shards': proposed.api,
    'api-e2e': proposed.api,
    'script-contracts': proposed.scripts,
    'docker-image-smoke': proposed.images,
    'web-e2e-plan': web,
    'web-e2e-lanes': web,
    'web-e2e': web,
    'observability-contract-live': proposed.monitoring === 'live',
    storybook: proposed.storybook,
    'test-email': proposed.email,
    'deployment-version': proposed.deployment,
  }
  return {
    proposed,
    reason: inputs.mode,
    effective: requiredCiJobs.filter((job) => selected[job]),
  }
}

/** Recompute permission from admitted inputs; an arbitrary effective list is never authority. */
export function validateExecutionPlan(plan, identity) {
  const keys = [
    'run',
    'attempt',
    'version',
    'phase',
    'repository',
    'event',
    'source',
    'inputs',
    'proposed',
    'reason',
    'effective',
  ]
  if (
    !plan ||
    typeof plan !== 'object' ||
    Array.isArray(plan) ||
    Object.keys(plan).length !== keys.length ||
    keys.some((key) => !(key in plan)) ||
    plan.version !== 3 ||
    plan.phase !== 'selection' ||
    !/^[\w.-]+\/[\w.-]+$/.test(identity.repository ?? '') ||
    !/^\d+$/.test(identity.run ?? '') ||
    !/^[1-9]\d*$/.test(identity.attempt ?? '') ||
    ['run', 'attempt', 'repository', 'event'].some((key) => plan[key] !== identity[key]) ||
    JSON.stringify(plan.source) !== JSON.stringify(identity.source)
  )
    throw new Error('Invalid CI execution plan or source identity')
  const inputs = plan.inputs
  if (
    !inputs ||
    Object.keys(inputs).sort().join() !==
      ['role', 'mode', 'areas', 'diffComplete', 'integration'].sort().join() ||
    (inputs.diffComplete && !identity.diffComplete) ||
    inputs.integration !== identity.integration ||
    inputs.role !== identity.role ||
    inputs.mode !== identity.mode
  )
    throw new Error('CI execution admission inputs disagree')
  const expected = coarseExecution(inputs)
  for (const key of ['proposed', 'reason', 'effective'])
    if (JSON.stringify(plan[key]) !== JSON.stringify(expected[key]))
      throw new Error('CI execution plan differs from coarse policy')
  return expected
}

/** Shared admission for the final gate and the two aggregates affected by legitimate skips. */
export function requireSelectedCi(results, plan, identity, scope = 'all') {
  const execution = validateExecutionPlan(plan, identity)
  const scopes = {
    all: requiredCiJobs,
    test: ['test-unit', 'test-redis', 'test-capability', 'test-notification-ai', 'api-e2e'],
    api: ['api-e2e-plan', 'api-e2e-shards'],
  }
  const jobs = scopes[scope]
  if (!jobs) throw new Error('Unknown CI admission scope')
  if (!results || results['ci-selection']?.result !== 'success')
    throw new Error('CI selector did not succeed')
  const actual = Object.keys(results)
  if (
    actual.length !== jobs.length + 1 ||
    actual.some((job) => job !== 'ci-selection' && !jobs.includes(job))
  )
    throw new Error('CI dependency inventory differs from the required jobs')
  const incomplete = jobs.filter(
    (job) => results[job]?.result !== (execution.effective.includes(job) ? 'success' : 'skipped')
  )
  if (incomplete.length)
    throw new Error(`CI jobs disagree with execution plan: ${incomplete.join(', ')}`)
  return execution
}
