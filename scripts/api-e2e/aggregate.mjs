import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { validateReports } from './validate.mjs'

export function aggregate(directory, outcomes) {
  if (outcomes.plan !== 'success' || outcomes.shards !== 'success') {
    throw new Error('Every API E2E dependency must succeed')
  }
  const plan = JSON.parse(readFileSync(resolve(directory, 'api-e2e-plan/plan.json')))
  const directories = readdirSync(directory).filter((name) => name.startsWith('api-e2e-report-'))
  const reports = directories.map((name) => {
    const childPlan = JSON.parse(readFileSync(resolve(directory, name, 'plan.json')))
    if (JSON.stringify(childPlan) !== JSON.stringify(plan))
      throw new Error('Shard plan differs from canonical plan')
    const shard = childPlan.shards.find(
      (item) => name === `api-e2e-report-${item.id.replace('/', '-')}`
    )
    if (!shard) throw new Error('Unknown shard artifact')
    return JSON.parse(
      readFileSync(resolve(directory, name, shard.id.replace('/', '-'), 'report.json'))
    )
  })
  validateReports(plan, reports)
  console.log(`Complete API E2E: ${plan.all.length} suites, ${reports.length} shards, ${plan.sha}`)
}
if (process.argv[1]?.endsWith('/aggregate.mjs')) {
  try {
    aggregate(process.argv[2], JSON.parse(process.env.API_E2E_OUTCOMES))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
