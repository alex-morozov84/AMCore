import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import {
  applyStructuralPlan,
  planStructuralComposition,
} from './path-algebra-structural-compose.mjs'
import { createProjectStructuralRegistry } from './project-content-materializer.mjs'

const root = process.cwd()
const cases = [
  ['apps/api/src/core/auth/locale-negotiation.spec.ts', 'negotiation-unit'],
  ['apps/api/test/auth.e2e-spec.ts', 'auth-e2e'],
  ['apps/api/test/oauth.e2e-spec.ts', 'oauth-e2e'],
]

function apply(pathname, variant, locale, source) {
  const registry = createProjectStructuralRegistry()
  const [plan] = planStructuralComposition(registry, [
    {
      kind: 'structural',
      dimension: 'locale',
      path: pathname,
      operationKey: 'locale.database-default-test',
      params: { locale, variant },
    },
  ])
  return applyStructuralPlan(registry, plan, source)
}

test('projects selected-locale auth fixtures and RU database-default tests', () => {
  for (const [pathname, variant] of cases) {
    const source = readFileSync(path.join(root, pathname), 'utf8')
    const en = apply(pathname, variant, 'en', source)
    const ru = apply(pathname, variant, 'ru', source)
    if (variant === 'auth-e2e') {
      assert.match(en, /Accept-Language', 'ru-RU,ru;q=0\.9'/)
      assert.match(en, /locale: 'en'/)
      assert.match(en, /body\.user\.locale\)\.toBe\('en'\)/)
    } else {
      assert.equal(en, source)
    }
    if (variant === 'negotiation-unit') {
      assert.match(ru, /makeReq\('ru-RU,ru;q=0\.9', 'ru'\)/)
      assert.match(ru, /expect\(negotiateLocale\(req\)\)\.toBe\('ru'\)/)
    } else {
      assert.match(ru, /expect\(user\?\.locale\)\.toBe\('ru'\)/)
    }
  }
})

test('missing or duplicated semantic test anchors fail closed', () => {
  const [pathname, variant] = cases[0]
  const source = readFileSync(path.join(root, pathname), 'utf8')
  const title = 'returns the negotiated supported locale for a matching header'
  assert.throws(() => apply(pathname, variant, 'ru', source.replace(title, 'renamed')))
  assert.throws(() => apply(pathname, variant, 'ru', `${source}\nit('${title}', () => {})\n`))
})

test('explicit body-locale priority keeps selected and other fixtures distinct', () => {
  const [pathname, variant] = cases[1]
  const source = readFileSync(path.join(root, pathname), 'utf8')
  const en = apply(pathname, variant, 'en', source)
  const ru = apply(pathname, variant, 'ru', source)
  assert.match(en, /Accept-Language', 'ru-RU,ru;q=0\.9'/)
  assert.match(en, /locale: 'en'/)
  assert.match(ru, /Accept-Language', 'en-US,en;q=0\.9'/)
  assert.match(ru, /locale: 'ru'/)
})

test('unsupported locale params are rejected by the registry schema', () => {
  const [pathname, variant] = cases[0]
  const source = readFileSync(path.join(root, pathname), 'utf8')
  assert.throws(() => apply(pathname, variant, 'de', source))
})
