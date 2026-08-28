// End-to-end against a real-repo copy, for the --storybook=disabled
// dimension specifically — see init-project.test.mjs's header for why a
// real-repo copy (not a hand-written fixture) and commit()/runInitProject()
// come from lib/init-project-test-helpers.mjs.
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createRealRepoCopy, git } from './lib/test-fixture.mjs'
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
  })
})
