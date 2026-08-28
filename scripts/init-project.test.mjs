// End-to-end against a real-repo copy (see test-fixture.mjs's header on
// createRealRepoCopy: a hand-written fixture can't stand in for apps/web's
// actual route tree). git-inits the copy itself, since only this file's
// tests go through the real CLI (and therefore assertCleanGitTree) rather
// than calling step.write() directly like project-plan-web-*.test.mjs.
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRealRepoCopy, git, installDependencies } from './lib/test-fixture.mjs'
import { commit, runInitProject } from './lib/init-project-test-helpers.mjs'

let copy

afterEach(() => {
  copy?.cleanup()
  copy = undefined
})

describe('init-project (end-to-end against a real-repo copy)', () => {
  test('--dry-run writes nothing and prints the en Prisma note', () => {
    copy = createRealRepoCopy()
    commit(copy.root)

    const result = runInitProject(copy.root, ['--dry-run', '--mode=single', '--locale=en'])

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Prisma: no DB default change needed/)
    assert.match(result.stdout, /--dry-run: no files were written/)
    assert.equal(git(copy.root, ['status', '--porcelain']).trim(), '')
  })

  test('rejects an unsupported --locale early, with a clear message', () => {
    copy = createRealRepoCopy()
    commit(copy.root)

    const result = runInitProject(copy.root, ['--dry-run', '--mode=single', '--locale=de'])

    assert.equal(result.status, 1)
    assert.match(result.stderr, /--locale=de is not one of the current supported locales: en, ru/)
  })

  test('--dry-run for a non-en locale prints the stricter Prisma note', () => {
    copy = createRealRepoCopy()
    commit(copy.root)

    const result = runInitProject(copy.root, ['--dry-run', '--mode=single', '--locale=ru'])

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Prisma: required manual follow-up before production use/)
    assert.match(result.stdout, /pnpm --filter api db:migrate/)
  })

  test('apply (--locale=en): PROJECT_CONTEXT.md, a real typecheck/lint/build, and an unprefixed link', async () => {
    copy = createRealRepoCopy()
    commit(copy.root)
    // Test-harness setup, not production behavior -- runProjectVerification
    // itself never installs (see verify.mjs's header).
    installDependencies(copy.root)

    const result = runInitProject(copy.root, ['--mode=single', '--locale=en', '--yes'], {
      skipVerify: false,
    })

    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.match(result.stdout, /typecheck: OK/)
    assert.match(result.stdout, /lint: OK/)
    assert.match(result.stdout, /web build: OK/)

    const context = readFileSync(path.join(copy.root, 'PROJECT_CONTEXT.md'), 'utf8')
    assert.match(context, /- \*\*i18n_mode:\*\* single/)
    assert.match(context, /- \*\*base_locale:\*\* en/)
    assert.match(context, /- \*\*supported_locales:\*\* \[en\]/)
    assert.equal(existsSync(path.join(copy.root, 'apps/web/src/app/[locale]')), false)

    // The real typecheck/build above already compiled packages/shared's dist
    // (apps/web and apps/api both depend on it) -- reuse that build rather
    // than paying for a second one just to prove this.
    const sharedDist = pathToFileURL(path.join(copy.root, 'packages/shared/dist/index.js')).href
    const { localizedFrontendUrl } = await import(sharedDist)
    assert.equal(
      localizedFrontendUrl('https://example.com', 'en', 'reset-password', { token: 'abc' }),
      'https://example.com/reset-password?token=abc'
    )
  })

  test('re-running after a successful apply fails closed with a clear message', () => {
    copy = createRealRepoCopy()
    commit(copy.root)
    const first = runInitProject(copy.root, ['--mode=single', '--locale=en', '--yes'])
    assert.equal(first.status, 0, first.stderr)

    const second = runInitProject(copy.root, ['--mode=single', '--locale=en', '--yes'])

    assert.equal(second.status, 1)
    assert.match(second.stderr, /has already been applied to this checkout/)
  })
})
