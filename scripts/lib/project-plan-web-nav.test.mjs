// Runs against a disposable copy of the real repo. Expected content was
// verified empirically (a real `eslint --fix` run against a scratch copy)
// before being hardcoded here — see project-plan-web-nav-links.mjs's header.
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createRealRepoCopy } from './test-fixture.mjs'
import { buildWebNavHooksSteps } from './project-plan-web-nav-hooks.mjs'
import { buildWebNavLogoutSteps } from './project-plan-web-nav-logout.mjs'
import { buildWebNavBffSteps } from './project-plan-web-nav-bff.mjs'
import { buildWebNavOauthSteps } from './project-plan-web-nav-oauth.mjs'
import { buildWebNavAppShellSteps } from './project-plan-web-nav-appshell.mjs'

let copy

afterEach(() => {
  copy?.cleanup()
  copy = undefined
})

function applyAndCheck(root, buildSteps, rel) {
  for (const step of buildSteps(root)) step.write()
  const filePath = path.join(root, rel)
  // Node's native TS support strips types but doesn't compile JSX, so
  // --check only works for the plain .ts files here; .tsx content
  // assertions below are the syntax proof for AppShell.tsx instead.
  if (rel.endsWith('.ts')) {
    assert.doesNotThrow(() => execFileSync('node', ['--check', filePath]), rel)
  }
  return readFileSync(filePath, 'utf8')
}

describe('web nav rewrites (against a real repo copy)', () => {
  test('use-login.ts / use-register.ts drop the locale object from router.push', () => {
    copy = createRealRepoCopy()
    for (const step of buildWebNavHooksSteps(copy.root)) step.write()

    for (const rel of [
      'apps/web/src/features/auth-login/model/use-login.ts',
      'apps/web/src/features/auth-register/model/use-register.ts',
    ]) {
      const filePath = path.join(copy.root, rel)
      assert.doesNotThrow(() => execFileSync('node', ['--check', filePath]), rel)
      const content = readFileSync(filePath, 'utf8')
      assert.match(content, /from 'next\/navigation'/)
      assert.match(content, /router\.push\('\/'\)/)
      assert.doesNotMatch(content, /i18n\/navigation|locale:/)
    }
  })

  test('use-logout.ts swaps to next/navigation', () => {
    copy = createRealRepoCopy()
    const content = applyAndCheck(
      copy.root,
      buildWebNavLogoutSteps,
      'apps/web/src/features/auth-logout/model/use-logout.ts'
    )
    assert.match(content, /from 'next\/navigation'/)
    assert.doesNotMatch(content, /i18n\/navigation/)
  })

  test('dal.ts drops the locale object from both redirect() calls', () => {
    copy = createRealRepoCopy()
    const content = applyAndCheck(
      copy.root,
      buildWebNavBffSteps,
      'apps/web/src/shared/api/bff/dal.ts'
    )
    assert.match(content, /redirect\('\/login'\)/)
    assert.match(content, /redirect\('\/'\)/)
    assert.match(content, /export async function redirectIfAuthenticated\(\): Promise<void>/)
    assert.doesNotMatch(content, /i18n\/navigation|getLocale|type Locale/)
  })

  test('oauth-exchange-handler.ts drops the locale parameter and unprefixes both URLs', () => {
    copy = createRealRepoCopy()
    const content = applyAndCheck(
      copy.root,
      buildWebNavOauthSteps,
      'apps/web/src/shared/api/bff/oauth-exchange-handler.ts'
    )
    assert.match(content, /handleOAuthExchange\(request: Request\): Promise<NextResponse>/)
    assert.match(content, /new URL\('\/', request\.url\)/)
    assert.match(content, /new URL\('\/login', request\.url\)/)
    assert.doesNotMatch(content, /\$\{locale\}/)
  })

  test('AppShell.tsx removes LocaleSwitcher and swaps the Link import', () => {
    copy = createRealRepoCopy()
    const content = applyAndCheck(
      copy.root,
      buildWebNavAppShellSteps,
      'apps/web/src/widgets/app-shell/ui/AppShell.tsx'
    )
    assert.doesNotMatch(content, /LocaleSwitcher/)
    assert.match(
      content,
      /import Link from 'next\/link'\nimport \{ useTranslations \} from 'next-intl'/
    )
  })
})
