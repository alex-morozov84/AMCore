// Runs read-only against the real repo — proves the glob actually finds
// the real story files (guards the guard: a typo'd pattern would otherwise
// pass vacuously with zero steps and delete nothing).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildStorybookFilesSteps } from './project-plan-storybook-files.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

describe('buildStorybookFilesSteps (against the real repo, read-only)', () => {
  test('deletes .storybook and every real *.stories.tsx file', () => {
    const steps = buildStorybookFilesSteps(REPO_ROOT)

    assert.ok(steps.length > 10, 'found a non-trivial number of story files')
    assert.ok(steps.every((step) => step.kind === 'delete'))

    const targets = steps.map((step) => step.target)
    assert.ok(targets.some((target) => target.endsWith('apps/web/.storybook')))
    assert.ok(targets.some((target) => target.endsWith('button.stories.tsx')))
    assert.ok(
      targets.slice(1).every((target) => target.endsWith('.stories.tsx')),
      'every non-.storybook target is a story file'
    )
  })
})
