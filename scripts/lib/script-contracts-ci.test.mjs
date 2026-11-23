import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parse } from 'yaml'

const ci = parse(readFileSync('.github/workflows/ci.yml', 'utf8'))
const ruleset = JSON.parse(readFileSync('.github/rulesets/main.json', 'utf8'))
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const required = ruleset.rules
  .find((rule) => rule.type === 'required_status_checks')
  .parameters.required_status_checks.map((check) => check.context)

test('the script contracts job runs the root test:scripts command', () => {
  const job = ci.jobs['script-contracts']
  assert.equal(job.name, 'Script contracts')
  assert.deepEqual(job.needs, ['ci-selection', 'lint', 'typecheck'])
  const step = job.steps.find((item) => item.name === 'Run script contract tests')
  assert.equal(step.run, 'pnpm test:scripts')
  assert.equal(
    pkg.scripts['test:scripts'],
    'node --test --test-concurrency=1 scripts/lib/*.test.mjs scripts/*.test.mjs'
  )
})

test('the script contracts job is a required check and no scaffolding check remains', () => {
  assert.ok(required.includes('Script contracts'))
  assert.equal(
    required.filter((context) => /scaffold/i.test(context)).length,
    0,
    'a removed scaffolding check must not stay required'
  )
})

test('every required check of the main ruleset names a job in a tracked workflow', () => {
  const names = new Set()
  for (const file of readdirSync('.github/workflows')) {
    const workflow = parse(readFileSync(`.github/workflows/${file}`, 'utf8'))
    for (const [id, job] of Object.entries(workflow.jobs ?? {})) names.add(job.name ?? id)
  }
  assert.deepEqual(
    required.filter((context) => !names.has(context)),
    [],
    'a required check without a job can never pass and blocks every merge'
  )
})

test('selection preflight dominates preparation and exclusions have direct selector dependencies', () => {
  const jobs = ci.jobs
  const selector = jobs['ci-selection']
  assert.equal(selector.permissions, undefined)
  assert.equal(selector.steps.find((step) => step.id === 'filter').with.token, '')
  assert.equal(
    selector.steps.find((step) => step.id === 'filter').with['predicate-quantifier'],
    'every'
  )
  const reaches = (id) => id === 'ci-selection' || [].concat(jobs[id].needs ?? []).some(reaches)
  for (const [id, job] of Object.entries(jobs)) {
    if (id === 'ci-selection') continue
    assert.ok(reaches(id), `${id} must depend on preflight`)
    if (!['ci-required', 'lint', 'typecheck', 'promtool'].includes(id)) {
      assert.ok(job.needs.includes('ci-selection'))
      assert.ok(job.if?.includes(`.effective, '${id}'`), id)
    }
  }
  assert.equal(
    jobs['ci-required'].steps.find((step) => step.run).env.CI_PLAN,
    '${{ needs.ci-selection.outputs.plan }}'
  )
})

test('API aggregate admits applicability before evidence and keeps selected coverage validation', () => {
  const api = ci.jobs['api-e2e']
  assert.deepEqual(api.needs, ['ci-selection', 'api-e2e-plan', 'api-e2e-shards'])
  assert.match(api.if, /always\(\).*'api-e2e'/)
  const admission = api.steps.findIndex((step) => step.id === 'admission')
  assert.equal(api.steps[admission].run, 'node scripts/ci-required.mjs api')
  assert.equal(api.steps[admission].env.CI_PLAN, '${{ needs.ci-selection.outputs.plan }}')
  for (const name of [
    'Download current-attempt evidence',
    'Require complete coverage and natural process exits',
  ]) {
    const index = api.steps.findIndex((step) => step.name === name)
    assert.ok(index > admission)
    assert.equal(api.steps[index].if, "steps.admission.outputs.selected == 'true'")
  }
  assert.equal(api.steps.at(-1).run, 'node scripts/api-e2e/aggregate.mjs api-e2e-evidence')
  assert.equal(
    ci.jobs['api-e2e-shards'].strategy.matrix,
    '${{ fromJSON(needs.api-e2e-plan.outputs.matrix) }}'
  )
})

test('heavy-off reaches Node observability checks without Docker preparation', () => {
  const staticJob = ci.jobs.promtool
  assert.ok(staticJob.needs.includes('ci-selection'))
  assert.equal(
    staticJob.steps.find((step) => step.run === 'pnpm test:observability-contract').if,
    undefined
  )
  for (const step of staticJob.steps.filter((step) =>
    /docker|fake scrape-token/i.test((step.run ?? '') + step.name)
  ))
    assert.match(step.if, /inputs.mode != 'heavy-off'/)
})
