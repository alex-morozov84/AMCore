// Runs every accumulated init:project --mode=single step together against
// a disposable copy of the real repo (see project-plan-web-structure.test
// .mjs's header for why) — this is the point where dangling references
// between slices (e.g. a moved file importing something another slice
// deleted) would actually surface.
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, globSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { createRealRepoCopy } from './test-fixture.mjs'
import {
  buildWebStructureSteps,
  buildWebLocaleDirCleanupSteps,
} from './project-plan-web-structure.mjs'
import { buildWebConfigSteps } from './project-plan-web-config.mjs'
import { buildWebPagesSteps } from './project-plan-web-pages.mjs'
import { buildWebNavSteps } from './project-plan-web-nav.mjs'
import { buildSharedLocaleSteps } from './project-plan-shared.mjs'

let copy

afterEach(() => {
  copy?.cleanup()
  copy = undefined
})

function applyAllSteps(root, locale) {
  // buildWebLocaleDirCleanupSteps MUST run last -- it recursively deletes
  // [locale]/, which every other apps/web step here is still reading from
  // or moving files out of.
  const steps = [
    ...buildSharedLocaleSteps(root, locale),
    ...buildWebStructureSteps(root),
    ...buildWebConfigSteps(root),
    ...buildWebPagesSteps(root),
    ...buildWebNavSteps(root),
    ...buildWebLocaleDirCleanupSteps(root),
  ]
  for (const step of steps) step.write()
  return steps
}

describe('the full init:project --mode=single transform (against a real repo copy)', () => {
  test('leaves no [locale] directory and every rewritten file in valid syntax', () => {
    copy = createRealRepoCopy()
    applyAllSteps(copy.root, 'en')

    assert.equal(existsSync(path.join(copy.root, 'apps/web/src/app/[locale]')), false)

    const rewrittenTsFiles = [
      'apps/web/src/app/auth/callback/route.ts',
      'apps/web/src/i18n/request.ts',
    ]
    for (const rel of rewrittenTsFiles) {
      assert.doesNotThrow(() => execFileSync('node', ['--check', path.join(copy.root, rel)]), rel)
    }
  })

  test('the root layout no longer resolves a per-request locale', () => {
    copy = createRealRepoCopy()
    applyAllSteps(copy.root, 'ru')

    const layout = readFileSync(path.join(copy.root, 'apps/web/src/app/layout.tsx'), 'utf8')
    assert.match(layout, /DEFAULT_LOCALE/)
    assert.doesNotMatch(layout, /resolveLocaleParam|generateStaticParams|setRequestLocale/)
  })

  test('(auth)/layout.tsx no longer renders LocaleSwitcher', () => {
    copy = createRealRepoCopy()
    applyAllSteps(copy.root, 'en')

    const authLayout = readFileSync(
      path.join(copy.root, 'apps/web/src/app/(auth)/layout.tsx'),
      'utf8'
    )
    assert.doesNotMatch(authLayout, /LocaleSwitcher/)
  })

  test('login/register no longer pass a locale to redirectIfAuthenticated', () => {
    copy = createRealRepoCopy()
    applyAllSteps(copy.root, 'en')

    for (const rel of [
      'apps/web/src/app/(auth)/login/page.tsx',
      'apps/web/src/app/(auth)/register/page.tsx',
    ]) {
      const content = readFileSync(path.join(copy.root, rel), 'utf8')
      assert.match(content, /redirectIfAuthenticated\(\)/)
      assert.doesNotMatch(content, /resolveLocaleParam/)
    }
  })

  test('no apps/web source file imports @/i18n/navigation afterward', () => {
    copy = createRealRepoCopy()
    applyAllSteps(copy.root, 'en')

    const offenders = globSync('apps/web/src/**/*.{ts,tsx}', { cwd: copy.root })
      .map((rel) => [rel, readFileSync(path.join(copy.root, rel), 'utf8')])
      .filter(([, content]) => content.includes('@/i18n/navigation'))
      .map(([rel]) => rel)

    assert.deepEqual(offenders, [])
  })
})
