// Runs read-only against the real repo's actual eslint.config.mjs and
// vitest.config.ts.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildStorybookEslintSteps } from './project-plan-storybook-eslint.mjs'
import { buildStorybookVitestSteps } from './project-plan-storybook-vitest.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

function assertValidSyntax(content, extension) {
  const dir = mkdtempSync(path.join(tmpdir(), 'amcore-storybook-config-check-'))
  try {
    const file = path.join(dir, `probe${extension}`)
    writeFileSync(file, content)
    assert.doesNotThrow(() => execFileSync('node', ['--check', file]))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('buildStorybookEslintSteps (against the real repo, read-only)', () => {
  test('removes the plugin import, ignore entry, and rules block', () => {
    const [step] = buildStorybookEslintSteps(REPO_ROOT)

    assert.equal(step.changed, true)
    assert.doesNotMatch(step.after, /storybook/i)
    assertValidSyntax(step.after, '.mjs')
  })
})

describe('buildStorybookVitestSteps (against the real repo, read-only)', () => {
  test('removes the storybook project and its now-unused imports', () => {
    const [step] = buildStorybookVitestSteps(REPO_ROOT)

    assert.equal(step.changed, true)
    assert.doesNotMatch(step.after, /storybook/i)
    assert.doesNotMatch(step.after, /playwright/i)
    assert.match(step.after, /name: 'unit'/)
    assertValidSyntax(step.after, '.ts')
  })
})
