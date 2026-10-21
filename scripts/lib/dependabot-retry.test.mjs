import assert from 'node:assert/strict'
import { test } from 'node:test'
import { eligibleRun, installationFailure, retryDependabot } from './dependabot-retry.mjs'

const repository = 'owner/repo'
const now = Date.parse('2026-10-21T12:00:00Z')
const pr = {
  number: 1,
  state: 'open',
  user: { login: 'dependabot[bot]', type: 'Bot' },
  head: { sha: 'head', repo: { full_name: repository } },
  base: { sha: 'base', ref: 'main', repo: { full_name: repository } },
}
const run = {
  id: 10,
  status: 'completed',
  conclusion: 'failure',
  run_attempt: 1,
  created_at: '2026-10-20T11:00:00Z',
  event: 'pull_request',
  path: '.github/workflows/ci.yml',
  head_sha: 'head',
  pull_requests: [{ number: 1, head: { sha: 'head' }, base: { sha: 'base' } }],
}
const install = { name: 'Install dependencies', conclusion: 'failure' }
const job = { status: 'completed', conclusion: 'failure', name: 'Lint', steps: [install] }

test('retry eligibility rejects unsafe identity, stale context, early and repeated attempts', () => {
  assert.equal(eligibleRun(pr, run, repository, now), true)
  for (const change of [
    { status: 'in_progress' },
    { conclusion: 'cancelled' },
    { run_attempt: 2 },
    { created_at: 'invalid' },
    { created_at: '2026-10-20T11:00:01Z' },
    { event: 'push' },
    { path: '.github/workflows/other.yml' },
    { head_sha: 'old' },
    { pull_requests: [] },
    { pull_requests: [{ number: 1, head: { sha: 'head' }, base: { sha: 'old' } }] },
  ])
    assert.equal(eligibleRun(pr, { ...run, ...change }, repository, now), false)
  for (const change of [
    { state: 'closed' },
    { user: { login: 'human', type: 'User' } },
    { user: { login: 'dependabot[bot]', type: 'User' } },
    { head: { ...pr.head, repo: { full_name: 'fork/repo' } } },
    { base: { ...pr.base, ref: 'release' } },
  ])
    assert.equal(eligibleRun({ ...pr, ...change }, run, repository, now), false)
})

test('install-only failures qualify; test failures, cancellations and incomplete jobs do not', () => {
  assert.equal(installationFailure([job]), true)
  assert.equal(
    installationFailure([{ ...job, steps: [install, { name: 'Cleanup', conclusion: 'failure' }] }]),
    false
  )
  assert.equal(installationFailure([job, { ...job, name: 'Test', steps: [] }]), true)
  assert.equal(installationFailure([]), false)
  assert.equal(
    installationFailure([{ ...job, steps: [{ name: 'Run tests', conclusion: 'failure' }] }]),
    false
  )
  assert.equal(installationFailure([job, { ...job, status: 'in_progress' }]), false)
  assert.equal(installationFailure([job, { ...job, conclusion: 'cancelled' }]), false)
  assert.equal(installationFailure([job, { ...job, name: 'Image', steps: [] }]), false)
  assert.equal(
    installationFailure([
      job,
      {
        ...job,
        steps: [
          { ...install, conclusion: 'success' },
          { name: 'Run tests', conclusion: 'failure' },
        ],
      },
    ]),
    false
  )
})

function client({ latest = run, fresh = pr, jobs = [job] } = {}) {
  let pullReads = 0
  let runReads = 0
  const calls = []
  const pulls = {
    list() {},
    async get() {
      return { data: ++pullReads === 1 ? pr : fresh }
    },
  }
  const actions = {
    listWorkflowRuns() {},
    listJobsForWorkflowRunAttempt() {},
    async reRunWorkflow(parameters) {
      calls.push(parameters)
    },
  }
  return {
    calls,
    rest: { pulls, actions },
    async paginate(endpoint, parameters) {
      assert.equal(parameters.per_page, 100)
      if (endpoint === pulls.list) return [pr]
      if (endpoint === actions.listWorkflowRuns) return [++runReads === 1 ? run : latest]
      assert.equal(parameters.attempt_number, 1)
      return jobs
    },
  }
}

for (const [name, options, expected] of [
  ['eligible', {}, 1],
  ['head changed', { fresh: { ...pr, head: { ...pr.head, sha: 'new' } } }, 0],
  ['base changed', { fresh: { ...pr, base: { ...pr.base, sha: 'new' } } }, 0],
  ['new run', { latest: { ...run, id: 11 } }, 0],
  ['manual rerun', { latest: { ...run, run_attempt: 2 } }, 0],
  ['tests failed', { jobs: [{ ...job, steps: [] }] }, 0],
])
  test(`controller rechecks identity and issues at most one full retry: ${name}`, async () => {
    const github = client(options)
    const count = await retryDependabot({
      github,
      context: { repo: { owner: 'owner', repo: 'repo' } },
      core: { info() {} },
      now,
    })
    assert.equal(count, expected)
    assert.deepEqual(github.calls, expected ? [{ owner: 'owner', repo: 'repo', run_id: 10 }] : [])
  })
