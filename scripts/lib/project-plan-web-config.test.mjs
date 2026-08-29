// Runs against a disposable copy of the real repo — see
// project-plan-web-structure.test.mjs's header comment for why.
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createRealRepoCopy } from './test-fixture.mjs'
import { buildWebConfigSteps } from './project-plan-web-config.mjs'

let copy

afterEach(() => {
  copy?.cleanup()
  copy = undefined
})

describe('buildWebConfigSteps (against a real repo copy)', () => {
  test('rewrites i18n/request.ts to a static locale and strips the navigation ban from eslint.config.mjs', () => {
    copy = createRealRepoCopy()
    const steps = buildWebConfigSteps(copy.root)
    for (const step of steps) step.write()

    const requestPath = path.join(copy.root, 'apps/web/src/i18n/request.ts')
    const request = readFileSync(requestPath, 'utf8')
    assert.match(request, /DEFAULT_LOCALE/)
    assert.doesNotMatch(request, /hasLocale|requestLocale|from '\.\/routing'/)
    // Node's native TS support can check erasable-syntax files directly —
    // real syntax validation, not just string matching.
    assert.doesNotThrow(() => execFileSync('node', ['--check', requestPath]))

    const eslintPath = path.join(copy.root, 'apps/web/eslint.config.mjs')
    const eslintConfig = readFileSync(eslintPath, 'utf8')
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
