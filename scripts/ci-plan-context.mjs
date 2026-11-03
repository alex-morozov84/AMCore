import { appendFileSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export function assertCurrentPlan(plan, env, source) {
  if (
    !env.GITHUB_RUN_ID ||
    !env.GITHUB_RUN_ATTEMPT ||
    !env.GITHUB_SHA ||
    plan?.run !== env.GITHUB_RUN_ID ||
    (plan?.runAttempt ?? plan?.attempt) !== env.GITHUB_RUN_ATTEMPT ||
    (plan?.sha ?? plan?.source) !== source ||
    source !== env.GITHUB_SHA
  )
    throw new Error(
      'Stale/missing CI plan: rerun the API E2E plan or Web E2E plan job with all dependent jobs; do not rerun individual/failed jobs.'
    )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const source = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    const publish = process.argv[2] === '--publish-api'
    const plan = JSON.parse(
      publish ? readFileSync(process.argv[3], 'utf8') : process.env.CI_EXPECTED_PLAN || 'null'
    )
    assertCurrentPlan(plan, process.env, source)
    if (publish) {
      if (!process.env.GITHUB_OUTPUT) throw new Error('Missing CI planner output')
      const { run, runAttempt, sha, inputs } = plan
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        `identity=${JSON.stringify({ run, runAttempt, sha, inputs })}\n`
      )
    }
  } catch (error) {
    console.error(error instanceof SyntaxError ? 'Invalid CI planner identity' : error.message)
    process.exitCode = 1
  }
}
