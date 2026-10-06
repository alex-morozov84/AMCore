import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { resolve } from 'node:path'
import { parse } from 'yaml'
import { ciLanes, selectedFiles, specFiles } from '../e2e-ci-plan.mjs'

const root = resolve(import.meta.dirname, '../..')
test('isolated path groups cover every real-stack file once, including new ordinary specs', () => {
  const standard = selectedFiles(root, 'standard')
  const disruptive = selectedFiles(root, 'disruptive')
  const combined = [...standard, ...disruptive]
  assert.deepEqual(combined.sort(), specFiles(root))
  assert.equal(new Set(combined).size, combined.length)
  assert.ok(standard.length)
  for (const file of disruptive) assert.match(file, /runtime-settings|background-work/)
})

test('CI invokes the same fail-closed local lane runner, preserves retries and isolated workers', () => {
  const jobs = parse(readFileSync(`${root}/.github/workflows/ci.yml`, 'utf8')).jobs
  const job = jobs['web-e2e-lanes']
  assert.equal(job.strategy['fail-fast'], false)
  assert.match(job.strategy.matrix, /fromJSON\(needs.web-e2e-plan.outputs.matrix\)/)
  assert.equal(
    job.steps.find((step) => step.name === 'Run isolated E2E lane').run,
    'node scripts/e2e-ci.mjs "$E2E_CI_LANE"'
  )
  const gate = jobs['web-e2e']
  assert.equal(gate.name, 'Web E2E')
  assert.equal(gate.if, '${{ always() }}')
  assert.deepEqual(gate.needs, ['web-e2e-plan', 'web-e2e-lanes'])
  for (const results of [
    ['success', 'success'],
    ['success', 'failure'],
    ['success', 'cancelled'],
    ['success', 'skipped'],
  ]) {
    const script = gate.steps[0].run.replace('node -e ', '').trim().slice(1, -1)
    const result = spawnSync(process.execPath, ['-e', script], {
      env: {
        E2E_RESULTS: JSON.stringify(
          Object.fromEntries(
            results.map((value, index) => [
              ['web-e2e-plan', 'web-e2e-lanes'][index],
              { result: value },
            ])
          )
        ),
      },
      encoding: 'utf8',
    })
    assert.equal(result.status, results.every((value) => value === 'success') ? 0 : 1)
  }
  assert.ok(ciLanes(root).includes('mocked'))
})
