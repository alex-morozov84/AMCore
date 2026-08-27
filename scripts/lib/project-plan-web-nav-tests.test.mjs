// Runs against a disposable copy of the real repo. Covers the three
// test-file-cleanup steps together: eslint-guards.test.ts's removed
// navigation-ban coverage, and both dal test files kept in sync with
// project-plan-web-nav-bff.mjs's dal.ts rewrite.
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createRealRepoCopy } from './test-fixture.mjs'
import { buildWebNavEslintGuardsSteps } from './project-plan-web-nav-eslint-guards.mjs'
import { buildWebNavDalGatingTestSteps } from './project-plan-web-nav-dal-gating-test.mjs'
import { buildWebNavDalOptionalTestSteps } from './project-plan-web-nav-dal-optional-test.mjs'

let copy

afterEach(() => {
  copy?.cleanup()
  copy = undefined
})

function applyAndRead(root, buildSteps, rel) {
  for (const step of buildSteps(root)) step.write()
  return readFileSync(path.join(root, rel), 'utf8')
}

describe('web nav test-file cleanup (against a real repo copy)', () => {
  test('eslint-guards.test.ts drops only the navigation-ban tests', () => {
    copy = createRealRepoCopy()
    const content = applyAndRead(
      copy.root,
      buildWebNavEslintGuardsSteps,
      'apps/web/src/test/eslint-guards.test.ts'
    )

    assert.doesNotMatch(content, /navigation/i)
    // Unrelated coverage (Zod locale, FSD boundaries, token styling) survives.
    assert.match(content, /bans a global Zod locale/)
    assert.match(content, /token-only styling/)
  })

  test('dal.gating.test.ts mocks next/navigation and drops the locale object', () => {
    copy = createRealRepoCopy()
    const content = applyAndRead(
      copy.root,
      buildWebNavDalGatingTestSteps,
      'apps/web/src/shared/api/bff/dal.gating.test.ts'
    )

    assert.doesNotThrow(() =>
      execFileSync('node', [
        '--check',
        path.join(copy.root, 'apps/web/src/shared/api/bff/dal.gating.test.ts'),
      ])
    )
    assert.match(content, /vi\.mock\('next\/navigation'/)
    assert.match(content, /toHaveBeenCalledWith\('\/login'\)/)
    assert.match(content, /toHaveBeenCalledWith\('\/'\)/)
    assert.match(content, /redirectIfAuthenticated\(\)/)
    assert.doesNotMatch(content, /i18n\/navigation|next-intl|locale:/)
  })

  test('dal.optional-session.test.ts drops the two dead mocks', () => {
    copy = createRealRepoCopy()
    const content = applyAndRead(
      copy.root,
      buildWebNavDalOptionalTestSteps,
      'apps/web/src/shared/api/bff/dal.optional-session.test.ts'
    )

    assert.doesNotMatch(content, /i18n\/navigation|next-intl/)
    assert.match(content, /describe\('getOptionalSession'/)
  })
})
