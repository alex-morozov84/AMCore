// Runs against a disposable copy of the real repo — see
// project-plan-web-structure.test.mjs's header comment for why.
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { createRealRepoCopy } from './test-fixture.mjs'
import { buildWebConfigSteps } from './project-plan-web-config.mjs'
import { buildProjectFactPlan } from './project-fact-plan.mjs'

let copy

afterEach(() => {
  copy?.cleanup()
  copy = undefined
})

describe('buildWebConfigSteps (against a real repo copy)', () => {
  test('rewrites i18n/request.ts while the shared owner strips the ESLint navigation ban', () => {
    copy = createRealRepoCopy()
    const [requestStep] = buildWebConfigSteps(copy.root)

    const requestPath = path.join(copy.root, 'apps/web/src/i18n/request.ts')
    const request = requestStep.after
    writeFileSync(requestPath, request)
    assert.match(request, /DEFAULT_LOCALE/)
    assert.doesNotMatch(request, /hasLocale|requestLocale|from '\.\/routing'/)
    // Node's native TS support can check erasable-syntax files directly —
    // real syntax validation, not just string matching.
    assert.doesNotThrow(() => execFileSync('node', ['--check', requestPath]))

    const eslintPath = path.join(copy.root, 'apps/web/eslint.config.mjs')
    const eslintConfig = buildProjectFactPlan(
      copy.root,
      { mode: 'single', locale: 'en' },
      'admin'
    ).sharedContentSteps.find((step) => step.target === eslintPath).after
    assert.doesNotMatch(eslintConfig, /NAVIGATION_PATHS/)
    assert.doesNotMatch(eslintConfig, /import-guards-navigation-source/)
    assert.match(
      eslintConfig,
      /'no-restricted-imports': \['error', \{ patterns: \[LAYER_BARREL\] \}\],/
    )
    assert.doesNotThrow(
      () => execFileSync('node', ['--check', eslintPath]),
      'eslint.config.mjs must stay valid JS'
    )
  })
})
