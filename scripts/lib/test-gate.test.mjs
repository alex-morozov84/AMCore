import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parse } from 'yaml'

const jobs = parse(readFileSync('.github/workflows/ci.yml', 'utf8')).jobs
const expected = [
  'test-unit-redis',
  'test-capability',
  'test-notification-ai',
  'test-focused-background',
  'api-e2e',
]
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
  const commands = {
    'test-unit-redis': ['pnpm test', 'pnpm --filter web test:integration'],
    'test-capability': ['pnpm test:capability-extension'],
    'test-notification-ai': ['pnpm test:extension-contracts'],
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

test('fallback retains all29 launches and separate partial reports', () => {
  const steps = jobs['test-focused-background'].steps
  const focused = steps.find((step) => step.name === 'Run focused API contracts')
  const background = steps.find((step) => step.name === 'Run background-work contracts')
  const root = JSON.parse(readFileSync('package.json', 'utf8'))
  const paths = `${focused.run} ${root.scripts['test:background-work-contracts']}`.match(
    /test\/[^\s]+\.e2e-spec\.ts/g
  )
  assert.equal(paths.length, 29)
  assert.equal(new Set(paths).size, 29)
  assert.equal(background.run, 'pnpm test:background-work-contracts')
  assert.notEqual(focused.env.API_E2E_OUTPUT, background.env.API_E2E_OUTPUT)
  for (const step of [focused, background])
    assert.ok(step.env.API_E2E_OUTPUT.startsWith('${{ github.workspace }}/.amcore/test-fallback/'))
  const artifact = steps.find((step) => step.uses?.startsWith('actions/upload-artifact@'))
  assert.equal(artifact.if, 'always()')
  assert.equal(artifact.with['if-no-files-found'], 'error')
  assert.equal(artifact.with['include-hidden-files'], true)
})
