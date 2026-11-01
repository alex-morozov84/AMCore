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
  assert.deepEqual(job.needs, ['lint', 'typecheck'])
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
