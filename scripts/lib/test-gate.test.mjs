import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parse } from 'yaml'

const jobs = parse(readFileSync('.github/workflows/ci.yml', 'utf8')).jobs
const expected = ['test-unit-redis', 'test-capability', 'test-notification-ai', 'api-e2e']
const gate = jobs.test
const script = gate.steps[0].run.trim().slice("node -e '".length, -1)
const success = () => Object.fromEntries(expected.map((key) => [key, { result: 'success' }]))
function verdict(results) {
  return spawnSync(process.execPath, ['-e', script], {
    env: { ...process.env, TEST_RESULTS: JSON.stringify(results) },
    encoding: 'utf8',
  }).status
}

test('Test accepts only the exact nonempty successful dependency set', () => {
  assert.equal(gate.name, 'Test')
  assert.equal(gate['timeout-minutes'], 5)
  assert.equal(gate.if, '${{ always() }}')
  assert.deepEqual(gate.needs, expected)
  assert.equal(gate.steps.length, 1)
  assert.equal(gate.steps[0].env.TEST_RESULTS, '${{ toJSON(needs) }}')
  assert.equal(verdict(success()), 0)
  for (const key of expected) {
    for (const result of ['failure', 'skipped', 'cancelled', 'neutral', 'unknown', '', null]) {
      assert.equal(verdict({ ...success(), [key]: { result } }), 1, `${key}: ${result}`)
    }
    const missing = success()
    delete missing[key]
    assert.equal(verdict(missing), 1)
    assert.equal(verdict({ ...success(), [key]: null }), 1)
  }
  for (const bad of [{}, [], null, { ...success(), undeclared: { result: 'success' } }])
    assert.equal(verdict(bad), 1)
})

test('independent leaves preserve commands and frozen preparation without aggregate cycles', () => {
  // The mirror step is first; its script never fails the job (a warning instead).
  const mirror = 'bash scripts/docker-registry-mirror.sh'
  const commands = {
    'test-unit-redis': [mirror, 'pnpm test', 'pnpm --filter web test:integration'],
    'test-capability': [mirror, 'pnpm test:capability-extension'],
    'test-notification-ai': [mirror, 'pnpm test:extension-contracts'],
  }
  for (const [key, runs] of Object.entries(commands)) {
    const job = jobs[key]
    assert.deepEqual(job.needs, ['lint', 'typecheck'])
    assert.deepEqual(
      job.steps
        .filter((step) => step.run && !step.run.startsWith('pnpm install'))
        .map((step) => step.run),
      runs
    )
    assert.ok(job.steps.some((step) => step.run === 'pnpm install --frozen-lockfile'))
    assert.ok(job.steps.every((step) => !step['continue-on-error'] && !step.if))
  }
  function visit(key, ancestors = []) {
    assert.ok(!ancestors.includes(key), `cycle: ${[...ancestors, key]}`)
    const needs = jobs[key].needs || []
    for (const child of typeof needs === 'string' ? [needs] : needs)
      visit(child, [...ancestors, key])
  }
  visit('test')
})

test('stock API coverage has one CI execution path while focused local commands remain', () => {
  assert.equal(jobs['test-focused-background'], undefined)
  assert.ok(gate.needs.includes('api-e2e'))
  const root = JSON.parse(readFileSync('package.json', 'utf8'))
  const api = JSON.parse(readFileSync('apps/api/package.json', 'utf8'))
  assert.match(
    root.scripts['test:background-work-contracts'],
    /^pnpm --filter api test:e2e --runTestsByPath /
  )
  assert.equal(api.scripts['test:e2e'], 'node ../../scripts/api-e2e-ci.mjs')
})
