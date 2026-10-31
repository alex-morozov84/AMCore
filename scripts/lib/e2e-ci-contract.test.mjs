import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, mkdtempSync, rmSync, mkdirSync, writeFileSync, globSync } from 'node:fs'
import { test } from 'node:test'
import { tmpdir } from 'node:os'
import { auditPlan } from './lighthouse-plan.mjs'
import { resolve, join, relative } from 'node:path'
import { parse } from 'yaml'
import { ciLanes, selectedFiles, specFiles } from '../e2e-ci-plan.mjs'
import { standReporters } from '../../apps/web/e2e/support/managed-target.mjs'

const root = resolve(import.meta.dirname, '../..')
test('CI report upload selects actual stand outputs without traversing copied dependencies', (t) => {
  const temporary = mkdtempSync(join(tmpdir(), 'ci-report-scope-'))
  t.after(() => rmSync(temporary, { recursive: true, force: true }))
  const directory = join(temporary, '.amcore/stands/owned-stand')
  const reporters = standReporters({ purpose: 'e2e', mocked: true }, directory)
  const html = reporters.find((row) => Array.isArray(row) && row[0] === 'html')[1].outputFolder
  const expected = [html, join(directory, 'test-results'), join(directory, 'inventory.json')]
  for (const path of [html, join(directory, 'test-results')]) {
    mkdirSync(path, { recursive: true })
    writeFileSync(join(path, 'index.html'), 'owned result')
  }
  writeFileSync(join(directory, 'inventory.json'), '{}')
  const nested = join(directory, 'source-1/node_modules/unrelated')
  for (const name of ['report', 'test-results']) {
    mkdirSync(join(nested, name), { recursive: true })
    writeFileSync(join(nested, name, 'index.html'), 'dependency data')
  }
  writeFileSync(join(nested, 'inventory.json'), '{}')
  const job = parse(readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')).jobs[
    'web-e2e-lanes'
  ]
  const patterns = job.steps
    .find((step) => step.id === 'original-upload')
    .with.path.trim()
    .split('\n')
  const selected = patterns.flatMap((pattern) => globSync(pattern, { cwd: temporary }))
  assert.deepEqual(
    selected.map((path) => path.replace(/\/$/, '')).sort(),
    expected.map((path) => relative(temporary, path)).sort()
  )
})

test('isolated path groups cover every real-stack file once, including new ordinary specs', () => {
  const standard = selectedFiles(root, 'standard')
  const disruptive = selectedFiles(root, 'disruptive')
  const combined = [...standard, ...disruptive]
  assert.deepEqual(combined.sort(), specFiles(root))
  assert.equal(new Set(combined).size, combined.length)
  assert.ok(standard.length)
  for (const file of disruptive)
    assert.match(
      file,
      /runtime-settings|background-work|redis-outage|redis-stall|refresh-owner-held/
    )
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
  const temporary = mkdtempSync(join(tmpdir(), 't084-ci-gate-'))
  const identity = { run: '123', attempt: '1', source: 'a'.repeat(40) }
  const plan = auditPlan(root, identity)
  for (const results of [
    ['success', 'success'],
    ['success', 'failure'],
    ['success', 'cancelled'],
    ['success', 'skipped'],
  ]) {
    const script = gate.steps
      .find((step) => step.name === 'Require every planned E2E lane to succeed')
      .run.replace('node -e ', '')
      .trim()
      .slice(1, -1)
    const result = spawnSync(process.execPath, ['-e', script], {
      env: {
        GITHUB_RUN_ID: identity.run,
        GITHUB_RUN_ATTEMPT: identity.attempt,
        GITHUB_SHA: identity.source,
        GITHUB_STEP_SUMMARY: join(temporary, 'summary'),
        AMCORE_EXPECTED_AUDIT_PLAN: JSON.stringify(plan),
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
  rmSync(temporary, { recursive: true, force: true })
  assert.ok(ciLanes(root).includes('mocked'))
})
