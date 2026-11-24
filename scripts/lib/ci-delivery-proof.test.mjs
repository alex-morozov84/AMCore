import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { resolveDeliveryProof } from './ci-delivery-proof.mjs'
import { coarseExecution, requiredCiJobs, requireSelectedCi } from './ci-required.mjs'

for (const role of ['upstream-starter', 'downstream-product']) {
  test(`one PR proof governs the whole ${role} delivery`, async (t) => {
    const root = mkdtempSync(`${tmpdir()}/ci-delivery-`)
    t.after(() => rmSync(root, { recursive: true, force: true }))
    const git = (...args) =>
      execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim()
    git('init', '-q')
    git('config', 'user.name', 'Fixture')
    git('config', 'user.email', 'fixture@example.invalid')
    git('commit', '--allow-empty', '-qm', 'base')
    const base = git('rev-parse', 'HEAD')
    const tree = git('rev-parse', 'HEAD^{tree}')
    const head = git('commit-tree', tree, '-p', base, '-m', 'head')
    const checkout = git('commit-tree', tree, '-p', base, '-p', head, '-m', 'PR')
    const after =
      role === 'upstream-starter'
        ? git('commit-tree', tree, '-p', base, '-m', 'squash')
        : git('commit-tree', tree, '-p', base, '-p', head, '-m', 'merge')
    const repository = 'fixture/product'
    const inputs = {
      role,
      mode: 'normal',
      areas: { web: true },
      diffComplete: true,
      integration: false,
    }
    const source = { base, checkout: after, head: after }
    const context = {
      source,
      repositoryId: '9',
      diffComplete: true,
      changedFiles: [],
      payload: { ref: 'refs/heads/main', before: base, after, forced: false },
      policy: { event: 'push', repository, role, mode: 'normal' },
    }
    const plan = {
      run: '42',
      attempt: '1',
      version: 3,
      phase: 'selection',
      repository,
      event: 'pull_request',
      source: { base, head, checkout },
      inputs,
      ...coarseExecution(inputs, 'pull_request'),
    }
    const proof = { version: 1, repositoryId: '9', pull: 7, tree, plan }
    const pull = {
      number: 7,
      merged_at: '2026-11-24T00:02:00Z',
      merge_commit_sha: after,
      base: { ref: 'main', repo: { id: 9 } },
      head: { sha: head },
    }
    const run = {
      id: 42,
      run_attempt: 1,
      head_sha: head,
      event: 'pull_request',
      status: 'completed',
      conclusion: 'success',
      path: '.github/workflows/ci.yml',
      repository: { id: 9 },
      updated_at: '2026-11-24T00:01:00Z',
      pull_requests: [{ number: 7, base: { sha: base } }],
    }
    const responses = {
      '': { allow_rebase_merge: false },
      [`commits/${after}/pulls`]: [pull],
      [`actions/workflows/ci.yml/runs?event=pull_request&head_sha=${head}&per_page=20`]: {
        workflow_runs: [run],
      },
      'actions/runs/42/attempts/1/jobs?per_page=100': {
        jobs: [{ name: 'CI required', conclusion: 'success', completed_at: run.updated_at }],
      },
      'actions/runs/42/artifacts?name=ci-pr-proof-1': {
        artifacts: [{ id: 17, name: 'ci-pr-proof-1' }],
      },
      'actions/artifacts/17/zip': proof,
      [`git/commits/${checkout}`]: {
        sha: checkout,
        tree: { sha: tree },
        parents: [{ sha: base }, { sha: head }],
      },
    }
    const api = async (key) => {
      assert.ok(key in responses, key)
      return responses[key]
    }
    const { credit } = await resolveDeliveryProof(root, context, api)
    assert.deepEqual(credit, { pull: 7, run: '42', attempt: '1' })
    if (role === 'upstream-starter') {
      responses[''].allow_rebase_merge = true
      assert.equal((await resolveDeliveryProof(root, context, api)).credit, undefined)
      responses[''].allow_rebase_merge = false
    }
    run.pull_requests = []
    assert.deepEqual((await resolveDeliveryProof(root, context, api)).credit, credit)
    const push = {
      ...plan,
      run: '43',
      event: 'push',
      source,
      inputs: { ...inputs, credit },
      ...coarseExecution({ ...inputs, credit }, 'push'),
    }
    const skipped = Object.fromEntries(requiredCiJobs.map((job) => [job, { result: 'skipped' }]))
    skipped['ci-selection'] = { result: 'success' }
    const identity = {
      ...context.policy,
      source,
      diffComplete: true,
      integration: false,
      run: '43',
      attempt: '1',
      credit,
    }
    assert.deepEqual(requireSelectedCi(skipped, push, identity).effective, [])
    assert.throws(() => requireSelectedCi(skipped, push, { ...identity, credit: undefined }))
    for (const mutation of [
      { changedFiles: ['scripts/ci-selection.mjs'] },
      { payload: { ...context.payload, forced: true } },
      { policy: { ...context.policy, mode: 'full' } },
      { source: { ...source, base: head }, payload: { ...context.payload, before: head } },
    ])
      assert.equal(
        (await resolveDeliveryProof(root, { ...context, ...mutation }, api)).credit,
        undefined
      )
    for (const [key, invalid] of [
      [`commits/${after}/pulls`, []],
      ['actions/artifacts/17/zip', { ...proof, tree: head }],
      ['actions/artifacts/17/zip', { ...proof, plan: { ...plan, attempt: '2' } }],
      [
        'actions/runs/42/attempts/1/jobs?per_page=100',
        { jobs: [{ name: 'CI required', conclusion: 'failure' }] },
      ],
    ]) {
      const original = responses[key]
      responses[key] = invalid
      assert.equal((await resolveDeliveryProof(root, context, api)).credit, undefined)
      responses[key] = original
    }
  })
}
