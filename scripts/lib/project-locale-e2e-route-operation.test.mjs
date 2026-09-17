import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import {
  applyStructuralPlan,
  planStructuralComposition,
} from './path-algebra-structural-compose.mjs'
import { createProjectStructuralRegistry } from './project-content-materializer.mjs'
import { buildLocaleE2eRouteFacts } from './project-locale-e2e-route-facts.mjs'
import { routeReferenceInventory } from './project-locale-e2e-route-inventory.mjs'
import {
  E2E_ROUTE_DENOMINATOR,
  E2E_ROUTE_SURFACES,
  LOCALE_ONLY_E2E_PATHS,
  OAUTH_E2E_ROUTE_SURFACE,
} from './project-locale-e2e-route-surfaces.mjs'
import { e2eRouteResiduals } from './project-locale-e2e-route-validation.mjs'
import { parseStructuralModel } from './path-algebra-ast-model.mjs'

const root = process.cwd()
const surfaces = [...E2E_ROUTE_SURFACES, OAUTH_E2E_ROUTE_SURFACE]

function source(pathname) {
  return readFileSync(path.join(root, pathname), 'utf8')
}

function apply(pathname, expectedReferences, locale, unavailableUiCases = 0) {
  const registry = createProjectStructuralRegistry()
  const surface = pathname.startsWith('apps/api/') ? 'oauth' : 'web'
  const [plan] = planStructuralComposition(registry, [
    {
      kind: 'structural',
      dimension: 'locale',
      path: pathname,
      operationKey: 'locale.e2e-route-topology',
      params: { locale, surface, expectedReferences, unavailableUiCases },
    },
  ])
  return applyStructuralPlan(registry, plan, source(pathname))
}

function outputs(locale) {
  return new Map(
    surfaces.map(([pathname, count, unavailable = 0]) => [
      pathname,
      apply(pathname, count, locale, unavailable),
    ])
  )
}

test('token-aware source inventory has the approved 99-reference denominator', () => {
  const retained = surfaces.reduce(
    (total, [pathname]) =>
      total + routeReferenceInventory(parseStructuralModel(pathname, source(pathname))).count,
    0
  )
  const deleted = LOCALE_ONLY_E2E_PATHS.reduce(
    (total, pathname) =>
      total + routeReferenceInventory(parseStructuralModel(pathname, source(pathname))).count,
    0
  )
  assert.equal(retained + deleted, E2E_ROUTE_DENOMINATOR)
  assert.equal(E2E_ROUTE_DENOMINATOR, 99)
})

test('EN and RU retain shared verification with identical prefixless topology', () => {
  for (const locale of ['en', 'ru']) {
    const projected = outputs(locale)
    assert.deepEqual(e2eRouteResiduals(projected), [])
    for (const [pathname] of surfaces) assert.ok(projected.get(pathname))
    const routeProgress = projected.get('apps/web/e2e/mocked/route-progress-bar.spec.ts')
    assert.equal([...routeProgress.matchAll(/^test\(/gm)].length, 5)
    assert.doesNotMatch(routeProgress, /selectOption\('ru'\)/)
  }
})

test('deletes only the two locale-only verification suites', () => {
  const facts = buildLocaleE2eRouteFacts('en')
  const deleted = facts.filter((fact) => fact.kind === 'delete').map((fact) => fact.path)
  assert.deepEqual(deleted, LOCALE_ONLY_E2E_PATHS)
  assert.equal(facts.filter((fact) => fact.kind === 'content').length, surfaces.length)
})

test('OAuth projection uses exact origin, path, and query assertions', () => {
  for (const locale of ['en', 'ru']) {
    const output = outputs(locale).get(OAUTH_E2E_ROUTE_SURFACE[0])
    assert.match(output, /expect\(res\.headers\.location\)\.toBeDefined\(\)/)
    assert.match(output, /new URL\(res\.headers\.location!\)/)
    assert.match(output, /expect\(redirect\.origin\)\.toBe\(TRUSTED_ORIGIN\)/)
    assert.match(output, /expect\(redirect\.pathname\)\.toBe\('\/auth\/callback'\)/)
    assert.match(output, /toEqual\(\['ticket'\]\)/)
    assert.match(
      output,
      new RegExp(`Accept-Language', '${locale === 'en' ? 'en-US,en;q=0\\.9' : 'ru-RU,ru;q=0\\.9'}`)
    )
    assert.match(output, new RegExp(`expect\\(user\\?\\.locale\\)\\.toBe\\('${locale}'\\)`))
    assert.match(output, new RegExp(`locale: '${locale}'`))
    assert.match(output, /toBe\(`\$\{TRUSTED_ORIGIN\}\/settings\/linked-accounts\?linked=google`\)/)
    assert.match(output, /toBe\(`\$\{TRUSTED_ORIGIN\}\/settings\/linked-accounts\?linked=apple`\)/)
  }
})

test('OAuth fixtures fail closed when selected-locale anchors drift', () => {
  const [pathname, count] = OAUTH_E2E_ROUTE_SURFACE
  const original = source(pathname)
  for (const value of ['ru-RU,ru;q=0.9', "locale: 'ru'"]) {
    const changed = original.replace(value, value.replace('ru', 'drifted'))
    const registry = createProjectStructuralRegistry()
    const [plan] = planStructuralComposition(registry, [
      {
        kind: 'structural',
        dimension: 'locale',
        path: pathname,
        operationKey: 'locale.e2e-route-topology',
        params: {
          locale: 'en',
          surface: 'oauth',
          expectedReferences: count,
          unavailableUiCases: 0,
        },
      },
    ])
    assert.throws(() => applyStructuralPlan(registry, plan, changed))
  }
})

test('residual contract catches every forbidden route form and switcher scenario', () => {
  const clean = outputs('ru')
  const pathname = 'apps/web/e2e/mocked/accessibility.spec.ts'
  for (const mutation of ["page.goto('/en/login')", "page.goto('/ru/login')", '// /(en|ru)/']) {
    const changed = new Map(clean)
    changed.set(pathname, `${changed.get(pathname)}\n${mutation}\n`)
    assert.ok(e2eRouteResiduals(changed).some((item) => item.startsWith(pathname)))
  }
  const progress = 'apps/web/e2e/mocked/route-progress-bar.spec.ts'
  const changed = new Map(clean)
  changed.set(progress, `${changed.get(progress)}\n// name: /language/i\nselectOption('ru')\n`)
  assert.ok(e2eRouteResiduals(changed).some((item) => item.endsWith('locale-switcher scenario')))
})

test('missing or unexpected route anchors fail closed', () => {
  const [pathname, count] = E2E_ROUTE_SURFACES[0]
  assert.throws(() => apply(pathname, count + 1, 'en'))
  assert.throws(() => apply(pathname, count - 1, 'ru'))
})
