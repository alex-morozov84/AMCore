import { execFileSync } from 'node:child_process'
import { artifactNames, readArtifactPlan, readArtifactReports } from './artifacts.mjs'
import { validatePlan, validateReports } from './validate.mjs'

export function aggregate(directory, outcomes, { mode = 'ci' } = {}) {
  if (outcomes.plan !== 'success' || outcomes.shards !== 'success') {
    throw new Error('Every API E2E dependency must succeed')
  }
  const names = artifactNames(mode)
  const plan = readArtifactPlan(directory, names)
  validatePlan(plan)
  const checkout = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  if (plan.sha !== checkout || plan.pullRequestHead !== (process.env.API_E2E_PR_HEAD || null))
    throw new Error('Canonical plan differs from current checkout/PR head')
  if (mode === 'ci') {
    if (
      !process.env.GITHUB_RUN_ID ||
      !process.env.GITHUB_RUN_ATTEMPT ||
      plan.run !== process.env.GITHUB_RUN_ID ||
      plan.runAttempt !== process.env.GITHUB_RUN_ATTEMPT
    )
      throw new Error('Canonical plan differs from current workflow run/attempt')
  } else if (
    mode !== 'local' ||
    process.env.GITHUB_ACTIONS === 'true' ||
    process.env.GITHUB_RUN_ID ||
    process.env.GITHUB_RUN_ATTEMPT ||
    plan.run !== 'local' ||
    plan.runAttempt !== '1'
  ) {
    throw new Error('Invalid local artifact admission context')
  }
  const reports = readArtifactReports(directory, names, plan)
  validateReports(plan, reports)
  console.log(`Complete API E2E: ${plan.all.length} suites, ${reports.length} shards, ${plan.sha}`)
}
if (process.argv[1]?.endsWith('/aggregate.mjs')) {
  try {
    aggregate(process.argv[2], JSON.parse(process.env.API_E2E_OUTCOMES), {
      mode: process.argv[3] === '--local' ? 'local' : 'ci',
    })
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
