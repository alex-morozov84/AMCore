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
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { createRealRepoCopy, git, installDependencies } from './lib/test-fixture.mjs'
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

  test('apply: flips the flag, updates the context field, deletes nothing, and real verification passes', () => {
    copy = createRealRepoCopy()
    commit(copy.root)
    installDependencies(copy.root)

    const result = runInitProject(copy.root, ['--route-progress=disabled', '--yes'], {
      skipVerify: false,
    })

    assert.equal(result.status, 0, result.stdout + result.stderr)
    // Non-destructive: real automated verification ran and passed, unlike
    // --storybook=disabled's printed manual follow-up.
    assert.match(result.stdout, /typecheck: OK/)
    assert.match(result.stdout, /lint: OK/)

    const flag = readFileSync(
      path.join(copy.root, 'apps/web/src/shared/lib/route-progress/route-progress-flag.ts'),
      'utf8'
    )
    assert.match(flag, /export const ROUTE_PROGRESS_ENABLED = false/)

    const context = readFileSync(path.join(copy.root, 'PROJECT_CONTEXT.md'), 'utf8')
    assert.match(context, /- \*\*frontend_route_progress:\*\* disabled/)

    // Nothing deleted: the component, controller, adapter, tests, and story
    // all still exist (owner decision: reversible by editing the flag back).
    for (const rel of [
      'apps/web/src/shared/ui/route-progress-bar.tsx',
      'apps/web/src/shared/ui/route-progress-bar.test.tsx',
      'apps/web/src/shared/ui/route-progress-bar.stories.tsx',
      'apps/web/src/shared/lib/route-progress/route-progress-controller.ts',
      'apps/web/src/shared/lib/route-progress/use-route-progress-router.ts',
    ]) {
      assert.equal(existsSync(path.join(copy.root, rel)), true, rel)
    }
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
