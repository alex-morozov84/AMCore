import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import {
  applyStructuralPlan,
  planStructuralComposition,
} from './path-algebra-structural-compose.mjs'
import { createProjectStructuralRegistry } from './project-content-materializer.mjs'
import { E2E_ROUTE_SURFACES } from './project-locale-e2e-route-surfaces.mjs'
import { e2eRouteResiduals } from './project-locale-e2e-route-validation.mjs'

const root = process.cwd()

function apply(pathname, expectedReferences, locale, unavailableUiCases = 0) {
  const registry = createProjectStructuralRegistry()
  const [plan] = planStructuralComposition(registry, [
    {
      kind: 'structural',
      dimension: 'locale',
      path: pathname,
      operationKey: 'locale.e2e-route-topology',
      params: { locale, surface: 'web', expectedReferences, unavailableUiCases },
    },
  ])
  return applyStructuralPlan(registry, plan, readFileSync(path.join(root, pathname), 'utf8'))
}

test('residual contract catches forbidden route, switcher, and weak-root forms', () => {
  const clean = new Map(
    E2E_ROUTE_SURFACES.map(([pathname, count, unavailable = 0]) => [
      pathname,
      apply(pathname, count, 'ru', unavailable),
    ])
  )
  const pathname = 'apps/web/e2e/mocked/accessibility.spec.ts'
  const mutations = [
    "page.goto('/en/login')",
    "page.goto('/ru/login')",
    '// /(en|ru)/',
    'expect(page).toHaveURL(/\\/?$/)',
  ]
  for (const mutation of mutations) {
    const changed = new Map(clean)
    changed.set(pathname, `${changed.get(pathname)}\n${mutation}\n`)
    assert.ok(e2eRouteResiduals(changed).some((item) => item.startsWith(pathname)))
  }
  const progress = 'apps/web/e2e/mocked/route-progress-bar.spec.ts'
  clean.set(progress, `${clean.get(progress)}\n// name: /language/i\nselectOption('ru')\n`)
  assert.ok(e2eRouteResiduals(clean).some((item) => item.endsWith('locale-switcher scenario')))
})

test('missing or unexpected route anchors fail closed', () => {
  const [pathname, count] = E2E_ROUTE_SURFACES[0]
  assert.throws(() => apply(pathname, count + 1, 'en'))
  assert.throws(() => apply(pathname, count - 1, 'ru'))
})
