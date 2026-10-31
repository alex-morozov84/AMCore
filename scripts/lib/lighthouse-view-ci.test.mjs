import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createCommittedCopy } from './init-project-test-helpers.mjs'
import { auditPlan, digest } from './lighthouse-plan.mjs'
import { writePair, writeManifest } from './lighthouse-reports.mjs'
import { packReports } from './lighthouse-archive.mjs'
import { validateEnvelopes } from './lighthouse-ci-evidence.mjs'

const passedJobs = { 'web-e2e-plan': { result: 'success' }, 'web-e2e-lanes': { result: 'success' } }
function command(root, file, env) {
  return spawnSync(process.execPath, [`scripts/lighthouse/${file}.mjs`], {
    cwd: root,
    env: { PATH: process.env.PATH, ...env },
    encoding: 'utf8',
    timeout: 5000,
  })
}
async function reports(output, plan, lane) {
  const files = [],
    results = []
  for (const id of plan.assignments[lane]) {
    files.push(
      ...(await writePair(
        join(output, 'bundle'),
        id,
        { html: '<html>safe native fixture</html>', json: '{}' },
        []
      ))
    )
    results.push({
      id,
      valid: true,
      identity: true,
      requiredData: true,
      policy: {
        passed: true,
        scores: { performance: 1, accessibility: 1, 'best-practices': 1, seo: 1 },
      },
    })
  }
  await writeManifest(join(output, 'bundle'), { ...plan, plan: plan.digest, lane, files, results })
  await packReports(join(output, 'bundle'), join(output, 'payload.json.gz'))
}

test('actual CI view preparation/status preserve original failure and refuse missing or corrupt viewing proof', async (t) => {
  const copies = [],
    root = createCommittedCopy(copies)
  t.after(() => copies.forEach((c) => c.cleanup()))
  const source = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  const plan = auditPlan(root, { run: '123', attempt: '2', source })
  const summary = join(root, 'summary.md')
  const base = {
    GITHUB_RUN_ID: plan.run,
    GITHUB_RUN_ATTEMPT: plan.attempt,
    GITHUB_SHA: source,
    GITHUB_REPOSITORY: 'example/repo',
    GITHUB_SERVER_URL: 'https://github.com',
    GITHUB_STEP_SUMMARY: summary,
    AMCORE_EXPECTED_AUDIT_PLAN: JSON.stringify(plan),
    ORIGINAL_UPLOAD: 'success',
  }
  const statuses = []
  let owner
  for (const [lane, ids] of Object.entries(plan.assignments)) {
    const output = join(root, '.amcore/lighthouse-results', plan.run, plan.attempt, lane)
    await mkdir(output, { recursive: true })
    await writeFile(
      join(output, 'lifecycle.json'),
      JSON.stringify({ setup: 'passed', test: 'passed', termination: 'passed', cleanup: 'passed' })
    )
    const env = {
      ...base,
      E2E_CI_LANE: lane,
      AUDIT_UPLOAD: 'success',
      AUDIT_ARTIFACT_ID: '456',
      AUDIT_ARTIFACT_URL: 'https://github.com/example/repo/actions/runs/123/artifacts/456',
    }
    if (ids.length) {
      await reports(output, plan, lane)
      const result = command(root, 'ci-prepare-view', env)
      assert.equal(result.status, 0, result.stderr)
      owner = { output, env, lane }
    }
    const status = command(root, 'ci-status', env)
    assert.equal(status.status, 0, status.stderr)
    statuses.push(JSON.parse(await readFile(join(output, 'status.json'), 'utf8')))
  }
  assert.ok(validateEnvelopes(plan, statuses, passedJobs).length)
  assert.match(await readFile(summary, 'utf8'), /Download reports/)
  const { output, env, lane } = owner
  await writeFile(summary, '')
  assert.equal(command(root, 'ci-status', { ...env, AUDIT_ARTIFACT_ID: '999' }).status, 0)
  assert.doesNotMatch(await readFile(summary, 'utf8'), /\[Download reports\]/)
  assert.equal(
    JSON.parse(await readFile(join(output, 'status.json'), 'utf8')).outcomes.view,
    'failed'
  )
  await writeFile(
    join(output, 'lifecycle.json'),
    JSON.stringify({ setup: 'passed', test: 'failed', termination: 'passed', cleanup: 'passed' })
  )
  assert.equal(command(root, 'ci-status', env).status, 0)
  const failed = JSON.parse(await readFile(join(output, 'status.json'), 'utf8'))
  assert.equal(failed.outcomes.test, 'failed')
  assert.throws(() =>
    validateEnvelopes(
      plan,
      statuses.map((s) => (s.lane === lane ? failed : s)),
      passedJobs
    )
  )
  await writeFile(join(output, 'view', `${plan.assignments[lane][0]}.html`), 'changed')
  assert.equal(command(root, 'ci-prepare-view', env).status, 1)
  assert.equal(command(root, 'ci-status', env).status, 0)
  assert.equal(
    JSON.parse(await readFile(join(output, 'status.json'), 'utf8')).outcomes.view,
    'failed'
  )
  for (const name of ['view', 'bundle', 'payload.json.gz'])
    await rm(join(output, name), { force: true, recursive: true })
  assert.equal(command(root, 'ci-prepare-view', env).status, 0)
  assert.equal(command(root, 'ci-status', env).status, 0)
  const diagnostic = JSON.parse(await readFile(join(output, 'status.json'), 'utf8'))
  assert.equal(diagnostic.outcomes.export, 'failed')
  assert.equal(diagnostic.outcomes.view, 'passed')
  assert.equal(diagnostic.viewHash, digest(await readFile(join(output, 'view/index.html'))))
  assert.equal(diagnostic.artifactId, undefined)
  assert.deepEqual(diagnostic.observed, [])
})
