import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parse } from 'yaml'

const ci = parse(readFileSync('.github/workflows/ci.yml', 'utf8'))

test('Linux recovery regressions are blocking steps in the ordinary Docker PR job', () => {
  assert.ok(ci.on.pull_request)
  assert.equal(ci.on.pull_request.paths, undefined)
  const job = ci.jobs['docker-image-smoke']
  assert.equal(job['runs-on'], 'ubuntu-latest')
  assert.equal(job.if, undefined)
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
