// End-to-end against a real-repo copy (see test-fixture.mjs's header on
// createRealRepoCopy: a hand-written fixture can't stand in for apps/web's
// actual route tree). git-inits the copy itself, since only this file's
// tests go through the real CLI (and therefore assertCleanGitTree) rather
// than calling step.write() directly like project-plan-web-*.test.mjs.
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createRealRepoCopy, git } from './lib/test-fixture.mjs'
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
