// Runs read-only against the real repo's actual apps/web/package.json.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildStorybookPackageSteps } from './project-plan-storybook-package.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

describe('buildStorybookPackageSteps (against the real repo, read-only)', () => {
  test('removes every Storybook script/devDependency, keeping everything else', () => {
    const [step] = buildStorybookPackageSteps(REPO_ROOT)
    const before = JSON.parse(step.before)
    const after = JSON.parse(step.after)

    assert.equal(step.changed, true)
    assert.doesNotMatch(step.after, /storybook/i)

    // Non-Storybook scripts/deps survive untouched.
    assert.equal(after.scripts.dev, before.scripts.dev)
    assert.equal(after.scripts.lint, before.scripts.lint)
    assert.equal(
      after.devDependencies['@testing-library/react'],
      before.devDependencies['@testing-library/react']
    )
    assert.deepEqual(after.dependencies, before.dependencies)
  })
})
