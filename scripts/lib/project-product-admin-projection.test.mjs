import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  applyStructuralPlan,
  planStructuralComposition,
} from './path-algebra-structural-compose.mjs'
import { createProjectStructuralRegistry } from './project-content-materializer.mjs'

function project(path, operationKey) {
  const registry = createProjectStructuralRegistry()
  const [plan] = planStructuralComposition(registry, [
    { kind: 'structural', dimension: 'locale', path, operationKey, params: { locale: 'ru' } },
  ])
  return applyStructuralPlan(registry, plan, readFileSync(path, 'utf8'))
}

test('completion projection retains selected native POST mount with one configured locale', () => {
  for (const prefix of ['', '(product-admin)/manage/']) {
    const result = project(
      `apps/web/src/app/[locale]/${prefix}auth/callback/page.tsx`,
      'locale.completion-page'
    )
    assert.match(result, /locale=\{DEFAULT_LOCALE\}/)
    assert.match(result, /query=\{await searchParams\}/)
    assert.doesNotMatch(result, /resolveLocaleParam|params: Promise/)
    assert.match(result, new RegExp(`kind="${prefix ? 'admin' : 'site'}-auth"`))
  }
})

test('legacy projection preserves organization/role params and supplies the configured locale', () => {
  const result = project(
    'apps/web/src/app/[locale]/(organization-access)/organizations/[id]/roles/[roleId]/route.ts',
    'locale.legacy-admin-route'
  )
  assert.match(result, /locale: DEFAULT_LOCALE/)
  assert.match(result, /await context.params/)
  assert.match(result, /roleId: string/)
  assert.match(result, /export const HEAD = GET/)
  assert.doesNotMatch(result, /locale: string/)
})

test('single-locale credential success preserves the chosen destination without an unsupported router option', () => {
  const result = project(
    'apps/web/src/_app/product-admin/ui/login-form.tsx',
    'locale.navigation-admin-login'
  )
  assert.match(result, /router.replace\(destination\)/)
  assert.match(result, /submit: actions.login/)
  assert.doesNotMatch(result, /locale: targetLocale|onSuccess: \(\{ user \}\)/)
})

test('selected redirects preserve the computed safe href instead of reverting to website login', () => {
  const result = project(
    'apps/web/src/_app/auth-completion/index.tsx',
    'locale.navigation-selected-redirect'
  )
  assert.match(result, /from 'next\/navigation'/)
  assert.match(result, /return redirect\(`/)
  assert.match(result, /context.loginPath/)
  assert.match(result, /oauthCompletionQuerySchema.safeParse/)
})

test('single-locale legacy list has no empty params object or unused route context', () => {
  const result = project(
    'apps/web/src/app/[locale]/(organization-access)/organizations/route.ts',
    'locale.legacy-admin-route'
  )
  assert.match(result, /function GET\(request: Request\)/)
  assert.match(result, /locale: DEFAULT_LOCALE/)
  assert.doesNotMatch(result, /Promise<\{\}>|context.params/)
})
