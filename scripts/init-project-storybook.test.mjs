// End-to-end against a real-repo copy, for the --storybook=disabled
// dimension specifically — see init-project.test.mjs's header for why a
// real-repo copy (not a hand-written fixture) and commit()/runInitProject()
// come from lib/init-project-test-helpers.mjs.
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, globSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { createRealRepoCopy, git, installDependencies } from './lib/test-fixture.mjs'
import { commit, runInitProject } from './lib/init-project-test-helpers.mjs'

let copy

afterEach(() => {
  copy?.cleanup()
  copy = undefined
})

describe('init-project --storybook=disabled (end-to-end against a real-repo copy)', () => {
  test('rejects a command with neither --mode nor --storybook', () => {
    copy = createRealRepoCopy()
    commit(copy.root)

    const result = runInitProject(copy.root, ['--dry-run'])

    assert.equal(result.status, 1)
    assert.match(result.stderr, /at least one of --mode or --storybook is required/)
  })

  test('rejects an unknown --storybook value', () => {
    copy = createRealRepoCopy()
    commit(copy.root)

    const result = runInitProject(copy.root, ['--dry-run', '--storybook=enabled'])

    assert.equal(result.status, 1)
    assert.match(result.stderr, /--storybook=enabled is not one of: disabled/)
  })

  test('--dry-run removes the CI job and allowlist, writes nothing', () => {
    copy = createRealRepoCopy()
    commit(copy.root)

    const result = runInitProject(copy.root, ['--dry-run', '--storybook=disabled'])

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /ci\.yml: remove the storybook job/)
    assert.match(result.stdout, /--dry-run: no files were written/)
    assert.equal(git(copy.root, ['status', '--porcelain']).trim(), '')
  })

  test('--mode and --storybook can be combined in one dry-run', () => {
    copy = createRealRepoCopy()
    commit(copy.root)

    const result = runInitProject(copy.root, [
      '--dry-run',
      '--mode=single',
      '--locale=en',
      '--storybook=disabled',
    ])

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Prisma: no DB default change needed/)
    assert.match(result.stdout, /ci\.yml: remove the storybook job/)
    // Proves the combined-step path (project-plan-combined.mjs) ran, not
    // two separate fileSteps that would have silently clobbered each other.
    assert.match(
      result.stdout,
      /update PROJECT_CONTEXT\.md fields \(single-locale \+ storybook-disabled\)/
    )
    assert.match(result.stdout, /remove the navigation ban and the Storybook plugin\/rules/)
  })

  test("applying both together leaves both dimensions' edits in PROJECT_CONTEXT.md and eslint.config.mjs", () => {
    copy = createRealRepoCopy()
    commit(copy.root)

    const result = runInitProject(copy.root, [
      '--mode=single',
      '--locale=en',
      '--storybook=disabled',
      '--yes',
    ])

    assert.equal(result.status, 0, result.stdout + result.stderr)

    const context = readFileSync(path.join(copy.root, 'PROJECT_CONTEXT.md'), 'utf8')
    assert.match(context, /- \*\*i18n_mode:\*\* single/)
    assert.match(context, /- \*\*frontend_storybook:\*\* disabled/)
    // Regression: the frontend_storybook bullet used to cite
    // docs/frontend/storybook.md, which this same apply deletes.
    assert.doesNotMatch(context, /docs\/frontend\/storybook\.md/)

    const eslintConfig = readFileSync(path.join(copy.root, 'apps/web/eslint.config.mjs'), 'utf8')
    assert.doesNotMatch(eslintConfig, /storybook/i)
    assert.doesNotMatch(eslintConfig, /NAVIGATION_PATHS/)
  })

  test('apply (--storybook=disabled): skips automated verification, prints the manual follow-up', () => {
    copy = createRealRepoCopy()
    commit(copy.root)
    // Test-harness setup, not production behavior -- installed *before*
    // apply here specifically to prove the point: apps/web/package.json's
    // dependency list still changes underneath this install, which is
    // exactly why automated verification is skipped for this dimension
    // rather than attempted and reported as a false "FAILED".
    installDependencies(copy.root)

    const result = runInitProject(copy.root, ['--storybook=disabled', '--yes'], {
      skipVerify: false,
    })

    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.match(result.stdout, /Storybook: apps\/web\/package\.json dependencies changed/)
    assert.match(result.stdout, /pnpm install/)
    assert.doesNotMatch(result.stdout, /typecheck: OK|typecheck: FAILED/)

    assert.equal(existsSync(path.join(copy.root, 'apps/web/.storybook')), false)
    assert.deepEqual(globSync('apps/web/src/**/*.stories.tsx', { cwd: copy.root }), [])

    const packageJson = readFileSync(path.join(copy.root, 'apps/web/package.json'), 'utf8')
    assert.doesNotMatch(packageJson, /storybook/i)

    const context = readFileSync(path.join(copy.root, 'PROJECT_CONTEXT.md'), 'utf8')
    assert.match(context, /- \*\*frontend_storybook:\*\* disabled/)
    // Regression: the frontend_storybook bullet used to cite
    // docs/frontend/storybook.md, which this same apply deletes.
    assert.doesNotMatch(context, /docs\/frontend\/storybook\.md/)
  })

  test('after the manual pnpm install the follow-up asks for, real typecheck/lint/build/test all pass', () => {
    copy = createRealRepoCopy()
    commit(copy.root)

    const result = runInitProject(copy.root, ['--storybook=disabled', '--yes'])
    assert.equal(result.status, 0, result.stdout + result.stderr)

    // The exact manual step the printed follow-up asks for.
    installDependencies(copy.root)

    for (const args of [
      ['typecheck'],
      ['lint'],
      ['--filter', 'web', 'build'],
      ['--filter', 'api', 'test'],
      ['--filter', 'web', 'test'],
    ]) {
      const verify = spawnSync('pnpm', args, {
        cwd: copy.root,
        encoding: 'utf8',
        env: { ...process.env, CI: 'true' },
      })
      assert.equal(verify.status, 0, `pnpm ${args.join(' ')}: ${verify.stdout}${verify.stderr}`)
    }
  })
})
