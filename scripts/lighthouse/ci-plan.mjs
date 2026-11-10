import { laneJobMinutes } from '../lib/lighthouse-deadlines.mjs'
import { appendFileSync } from 'node:fs'
import { invariant } from '../lib/lighthouse-plan.mjs'
import { expectedSummary } from '../lib/lighthouse-view-summary.mjs'

export function publishPlan(plan, env = process.env) {
  invariant(env.GITHUB_OUTPUT && env.GITHUB_STEP_SUMMARY, 'missing-ci-plan-output')
  const matrix = {
    include: Object.entries(plan.assignments).map(([lane, ids]) => ({
      lane,
      timeout: laneJobMinutes(ids.length > 0),
    })),
  }
  appendFileSync(env.GITHUB_STEP_SUMMARY, expectedSummary(plan))
  appendFileSync(
    env.GITHUB_OUTPUT,
    `matrix=${JSON.stringify(matrix)}\naudit-plan=${JSON.stringify(plan)}\n`
  )
}
