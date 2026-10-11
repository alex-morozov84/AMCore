import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function artifactNames(mode) {
  if (mode === 'local') {
    if (
      process.env.GITHUB_ACTIONS === 'true' ||
      process.env.GITHUB_RUN_ID ||
      process.env.GITHUB_RUN_ATTEMPT
    )
      throw new Error('Invalid local artifact admission context')
    return { plan: 'api-e2e-plan', report: 'api-e2e-report-' }
  }
  if (
    mode !== 'ci' ||
    !process.env.GITHUB_RUN_ID ||
    !/^[1-9]\d*$/.test(process.env.GITHUB_RUN_ATTEMPT || '')
  )
    throw new Error('Invalid workflow run/attempt artifact context')
  const prefix = `api-e2e-attempt-${process.env.GITHUB_RUN_ATTEMPT}-`
  return { plan: `${prefix}plan`, report: `${prefix}report-` }
}

function read(directory, name) {
  return JSON.parse(readFileSync(resolve(directory, name)))
}

export function readArtifactPlan(directory, names) {
  return read(directory, `${names.plan}/plan.json`)
}

export function readArtifactReports(directory, names, plan) {
  const entries = readdirSync(directory)
  const expected = [
    names.plan,
    ...plan.shards.map((shard) => `${names.report}${shard.id.replace('/', '-')}`),
  ]
  if (names.plan !== 'api-e2e-plan' && entries.some((name) => !expected.includes(name)))
    throw new Error('Unexpected current-attempt artifact')
  return entries
    .filter((name) => name.startsWith(names.report))
    .map((name) => {
      const childPlan = read(directory, `${name}/plan.json`)
      if (JSON.stringify(childPlan) !== JSON.stringify(plan))
        throw new Error('Shard plan differs from canonical plan')
      const shard = childPlan.shards.find(
        (item) => name === `${names.report}${item.id.replace('/', '-')}`
      )
      if (!shard) throw new Error('Unknown shard artifact')
      return read(directory, `${name}/${shard.id.replace('/', '-')}/report.json`)
    })
}
