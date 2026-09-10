// Runs against a disposable copy of the real repo. Expected content was
// verified empirically (a real `eslint --fix` run against a scratch copy)
// before being hardcoded here.
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createRealRepoCopy } from './test-fixture.mjs'
import { buildWebNavHooksSteps } from './project-plan-web-nav-hooks.mjs'
import { buildWebNavBffSteps } from './project-plan-web-nav-bff.mjs'
import { buildWebNavOauthSteps } from './project-plan-web-nav-oauth.mjs'
import { buildWebNavAppShellSteps } from './project-plan-web-nav-appshell.mjs'
import { buildWebNavRouteProgressRouterSteps } from './project-plan-web-nav-route-progress-router.mjs'
import { buildWebNavRouteProgressBarSteps } from './project-plan-web-nav-route-progress-bar.mjs'

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
      // Navigation-source no longer lives here (P1 item 8 moved it into
      // useRouteProgressRouter() / use-route-progress-router.ts's own
      // transform) -- only the { locale } push option drop is this file's
      // concern now.
      assert.match(content, /useRouteProgressRouter/)
      assert.match(content, /router\.push\('\/'\)/)
      assert.doesNotMatch(content, /i18n\/navigation|locale:/)
    }
  })

  // use-logout.ts has no transform of its own: since P1 item 8 migrated it
  // to useRouteProgressRouter(), it calls only push('/login') with no
  // locale option, so nothing about its content needs to change for
  // single-locale mode -- the navigation-source swap lives entirely in
  // use-route-progress-router.ts now (see that transform's own test file).

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

  test('use-route-progress-router.ts drops locale-aware navigation', () => {
    copy = createRealRepoCopy()
    const content = applyAndCheck(
      copy.root,
      buildWebNavRouteProgressRouterSteps,
      'apps/web/src/shared/lib/route-progress/use-route-progress-router.ts'
    )
    assert.match(content, /from 'next\/navigation'/)
    assert.doesNotMatch(content, /i18n\/navigation/)
  })

  test('route-progress-bar.tsx drops locale-aware navigation', () => {
    copy = createRealRepoCopy()
    const content = applyAndCheck(
      copy.root,
      buildWebNavRouteProgressBarSteps,
      'apps/web/src/shared/ui/route-progress-bar.tsx'
    )
    assert.match(content, /usePathname, useSearchParams \} from 'next\/navigation'/)
    assert.doesNotMatch(content, /i18n\/navigation/)
  })

  // AppShell's Link import (`RouteProgressLink` from
  // `@/shared/ui/route-progress-link`) needs no swap of its own -- that
  // wrapper's single-locale variant lives entirely in
  // project-plan-web-nav-route-progress-link.mjs, same reasoning as
  // use-logout.ts above.
  test('AppShell.tsx removes LocaleSwitcher, leaves RouteProgressLink alone', () => {
    copy = createRealRepoCopy()
    const content = applyAndCheck(
      copy.root,
      buildWebNavAppShellSteps,
      'apps/web/src/widgets/app-shell/ui/AppShell.tsx'
    )
    assert.doesNotMatch(content, /LocaleSwitcher/)
    assert.match(content, /RouteProgressLink/)
  })
})
