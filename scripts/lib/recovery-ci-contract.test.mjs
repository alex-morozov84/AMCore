import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parse } from 'yaml'
import { coarseExecution } from './ci-required.mjs'

const ci = parse(readFileSync('.github/workflows/ci.yml', 'utf8'))

test('Linux recovery regressions remain blocking whenever Docker is selected', () => {
  assert.ok(ci.on.pull_request)
  assert.equal(ci.on.pull_request.paths, undefined)
  const job = ci.jobs['docker-image-smoke']
  assert.equal(job['runs-on'], 'ubuntu-latest')
  assert.match(job.if, /effective, 'docker-image-smoke'/)
  assert.ok(job.needs.includes('ci-selection'))
  for (const areas of [{ infra: true }, { common: true }, { tools: true }]) {
    const execution = coarseExecution({
      role: 'upstream-starter',
      mode: 'normal',
      areas,
      diffComplete: true,
      integration: false,
    })
    assert.ok(execution.effective.includes('docker-image-smoke'))
  }
  assert.equal(job['continue-on-error'], undefined)
  const step = job.steps.find((s) => s.run?.includes('recover-ownership.live.mjs'))
  assert.ok(step, 'Linux ownership regression must run automatically')
  assert.equal(step.if, undefined)
  assert.equal(step['continue-on-error'], undefined)
  assert.equal(
    step.run,
    'node --test --test-concurrency=1 scripts/load-test/test/recover-ownership.live.mjs scripts/load-test/test/recover.live.mjs'
  )
})
