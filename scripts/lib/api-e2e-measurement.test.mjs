import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parse } from 'yaml'

test('measurement uses fresh cold stores only in API jobs and retains runner evidence', () => {
  const workflow = parse(readFileSync('.github/workflows/ci.yml', 'utf8'))
  assert.equal(workflow.env.API_E2E_CACHE_MODE, 'warm')
  const planSteps = workflow.jobs['api-e2e-plan'].steps
  assert.match(planSteps.find((step) => step.id === 'plan').run, /--plan=3\)/)
  assert.equal(
    workflow.jobs['api-e2e-shards'].strategy.matrix,
    '${{ fromJSON(needs.api-e2e-plan.outputs.matrix) }}'
  )
  assert.equal(
    planSteps.find((step) => step.name === 'Retain canonical inventory').with.name,
    'api-e2e-attempt-${{ github.run_attempt }}-plan'
  )
  assert.equal(
    workflow.jobs['api-e2e-shards'].steps.find(
      (step) => step.name === 'Retain partial and final evidence'
    ).with.name,
    'api-e2e-attempt-${{ github.run_attempt }}-report-${{ steps.artifact.outputs.shard }}'
  )
  const download = workflow.jobs['api-e2e'].steps.find(
    (step) => step.name === 'Download current-attempt evidence'
  )
  assert.equal(download.with.pattern, 'api-e2e-attempt-${{ github.run_attempt }}-*')
  assert.notEqual(download.with['merge-multiple'], true)
  for (const name of ['api-e2e-plan', 'api-e2e-shards']) {
    const steps = workflow.jobs[name].steps
    const setup = steps.find((step) => step.id === 'node')
    assert.equal(setup.with.cache, "${{ env.API_E2E_CACHE_MODE == 'warm' && 'pnpm' || '' }}")
    const cold = steps.findIndex((step) => step.name === 'Use isolated cold dependency store')
    const install = steps.findIndex((step) => step.name === 'Install dependencies')
    const capture = steps.findIndex((step) => step.name === 'Record runner and cache measurement')
    const prepare = steps.findIndex((step) => step.name === 'Prepare fresh job')
    assert.ok(cold >= 0 && cold < install && install < capture && capture < prepare)
    assert.equal(steps[cold].if, "env.API_E2E_CACHE_MODE == 'cold'")
    assert.match(steps[cold].run, /RUNNER_TEMP/)
  }
  assert.equal(
    workflow.jobs['test-focused-background'].steps.find((step) => step.name === 'Setup Node.js')
      .with.cache,
    'pnpm'
  )
  const final = workflow.jobs['api-e2e-shards'].steps.find(
    (step) => step.name === 'Record final resource measurement'
  )
  assert.equal(final.if, 'always()')
  assert.match(
    workflow.jobs['api-e2e-plan'].steps.find((step) => step.name === 'Retain canonical inventory')
      .with.path,
    /measurement-before.json/
  )
})
