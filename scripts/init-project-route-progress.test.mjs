// End-to-end against a real-repo copy, for the --route-progress=disabled
// dimension specifically — see init-project.test.mjs's header for why a
// real-repo copy (not a hand-written fixture) and commit()/runInitProject()
// come from lib/init-project-test-helpers.mjs. Unlike --storybook, this
// dimension is non-destructive (owner decision, 2026-09-09): no file is
// moved or deleted, so — unlike init-project-storybook.test.mjs — real
// automated verification (typecheck/lint/build/test) is expected to run
// and pass on every apply here, not be skipped for a manual follow-up.
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { applyFilesystemTransaction } from './lib/filesystem-transaction.mjs'
import { runInitCommand } from './lib/init-engine.mjs'
import { prepareProjectInit } from './lib/project-init-plan.mjs'
import { createRealRepoCopy, git } from './lib/test-fixture.mjs'
import { commit, runInitProject } from './lib/init-project-test-helpers.mjs'

let copy

afterEach(() => {
  copy?.cleanup()
  copy = undefined
})

describe('init-project --route-progress=disabled (end-to-end against a real-repo copy)', () => {
  test('rejects an unknown --route-progress value', () => {
    copy = createRealRepoCopy()
    commit(copy.root)

    const result = runInitProject(copy.root, ['--dry-run', '--route-progress=enabled'])

    assert.equal(result.status, 1)
    assert.match(result.stderr, /--route-progress=enabled is not one of: disabled/)
  })

  test('--dry-run flips the flag and the context field, writes nothing', () => {
    copy = createRealRepoCopy()
    commit(copy.root)

    const result = runInitProject(copy.root, ['--dry-run', '--route-progress=disabled'])

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /route-progress-flag\.ts: set ROUTE_PROGRESS_ENABLED to false/)
    assert.match(result.stdout, /update frontend_route_progress for the disabled choice/)
    assert.match(result.stdout, /--dry-run: no files were written/)
    assert.equal(git(copy.root, ['status', '--porcelain']).trim(), '')
  })

  test('re-running after a successful apply fails closed with a clear message', () => {
    copy = createRealRepoCopy()
    commit(copy.root)

    const first = runInitProject(copy.root, ['--route-progress=disabled', '--yes'])
    assert.equal(first.status, 0, first.stdout + first.stderr)

    const second = runInitProject(copy.root, ['--dry-run', '--route-progress=disabled'])
    assert.equal(second.status, 1)
    assert.match(second.stderr, /does not declare "export const ROUTE_PROGRESS_ENABLED = true"/)
  })

  test('confirmed apply submits the complete route-progress plan to M4 exactly once', async () => {
    copy = createRealRepoCopy()
    commit(copy.root)
    const prepared = prepareProjectInit(copy.root, { 'route-progress': 'disabled' }, 'admin')
    const calls = []

    await runInitCommand({
      cwd: copy.root,
      flags: { yes: true },
      operationPlan: prepared.operationPlan,
      applyFilesystem: (input) => calls.push(input),
      verify: () => [],
    })

    assert.equal(calls.length, 1)
    assert.equal(calls[0].operations.length, 2)
  })

  test('an injected M4 failure rolls both route-progress writes back', () => {
    copy = createRealRepoCopy()
    const prepared = prepareProjectInit(copy.root, { 'route-progress': 'disabled' }, 'admin')
    const operations = prepared.operationPlan.operationsForApply()
    const before = operations.map((operation) => [operation.target, gitFile(operation.target)])

    assert.throws(
      () =>
        applyFilesystemTransaction({
          root: copy.root,
          operations,
          hooks: {
            beforeMutation: ({ index }) => {
              if (index === 1) throw new Error('injected route-progress failure')
            },
          },
        }),
      /injected route-progress failure/
    )
    for (const [target, content] of before) assert.equal(gitFile(target), content)
  })

  test('composes with --mode in one dry-run via the combined PROJECT_CONTEXT.md step', () => {
    copy = createRealRepoCopy()
    commit(copy.root)

    const result = runInitProject(copy.root, [
      '--dry-run',
      '--mode=single',
      '--locale=en',
      '--route-progress=disabled',
    ])

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /update PROJECT_CONTEXT\.md fields for the combined dimensions/)
    // The route-progress flag file itself is never a shared target, so it
    // keeps its own independent step even when combined.
    assert.match(result.stdout, /route-progress-flag\.ts: set ROUTE_PROGRESS_ENABLED to false/)
    // eslint.config.mjs is touched here only by --mode's own standalone step
    // (it always edits that file, storybook or not). The *combined*
    // eslint.config.mjs step is --mode + --storybook only — --route-progress
    // never triggers it, so that specific wording must not appear.
    assert.doesNotMatch(result.stdout, /remove the navigation ban and the Storybook plugin\/rules/)
  })
})

function gitFile(target) {
  return git(copy.root, ['hash-object', target])
}
