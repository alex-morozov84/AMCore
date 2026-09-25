import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { CONFLICT_CODES, PathAlgebraConflictError } from './path-algebra-errors.mjs'
import {
  applyStructuralPlan,
  planStructuralComposition,
} from './path-algebra-structural-compose.mjs'
import { createProjectStructuralRegistry } from './project-content-materializer.mjs'
import { e2eUiExpectationInventory } from './project-locale-e2e-ui-inventory.mjs'
import {
  E2E_UI_EXPECTATION_DENOMINATOR,
  E2E_UI_PROFILES,
  E2E_UI_SURFACES,
} from './project-locale-e2e-ui-surfaces.mjs'
import { e2eUiResiduals } from './project-locale-e2e-ui-validation.mjs'
import { parseStructuralModel } from './path-algebra-ast-model.mjs'

const root = process.cwd()
const source = (pathname) => readFileSync(path.join(root, pathname), 'utf8')

function fact(surface, locale) {
  return {
    kind: 'structural',
    dimension: 'locale',
    path: surface.path,
    operationKey: 'locale.e2e-ui-expectations',
    params: {
      locale,
      namespaces: surface.namespaces,
      expectedReferences: surface.expectedReferences,
    },
  }
}

function apply(surface, locale, text = source(surface.path)) {
  const registry = createProjectStructuralRegistry()
  const [plan] = planStructuralComposition(registry, [fact(surface, locale)])
  return applyStructuralPlan(registry, plan, text)
}

function outputs(locale) {
  return new Map(E2E_UI_SURFACES.map((surface) => [surface.path, apply(surface, locale)]))
}

test('AST-aware inventory fixes the bounded 60-expectation denominator', () => {
  const count = E2E_UI_SURFACES.reduce((total, surface) => {
    const model = parseStructuralModel(surface.path, source(surface.path))
    return total + e2eUiExpectationInventory(model, surface.namespaces).count
  }, 0)
  assert.equal(count, E2E_UI_EXPECTATION_DENOMINATOR)
  assert.equal(count, 60)
})

test('EN is byte-identical and RU has only concrete selected-catalogue expectations', () => {
  for (const surface of E2E_UI_SURFACES) assert.equal(apply(surface, 'en'), source(surface.path))
  assert.deepEqual(e2eUiResiduals('en', outputs('en')), [])
  assert.deepEqual(e2eUiResiduals('ru', outputs('ru')), [])
})

test('RU keeps technical strings and test semantics outside localized selectors', () => {
  const projected = outputs('ru')
  const login = projected.get('apps/web/e2e/mocked/login-validation.spec.ts')
  assert.match(login, /spike-e2e@example\.com/)
  assert.match(login, /aria-invalid/)
  const progress = projected.get('apps/web/e2e/mocked/route-progress-bar.spec.ts')
  assert.match(progress, /data-route-progress-ready/)
  assert.match(progress, /transition-duration/)
  const oauth = projected.get('apps/web/e2e/server-mocked/oauth-visibility.spec.ts')
  assert.match(oauth, /providers: \['google'\]/)
})

test('every represented English localized class is rejected when restored', () => {
  const clean = outputs('ru')
  for (const entries of Object.values(E2E_UI_PROFILES)) {
    for (const [en, ru] of entries) {
      const target = E2E_UI_SURFACES.find((surface) => clean.get(surface.path).includes(ru))
      assert.ok(target, `unused localized mapping ${en}`)
      const changed = new Map(clean)
      changed.set(target.path, changed.get(target.path).replace(ru, en))
      assert.ok(e2eUiResiduals('ru', changed).some((item) => item.startsWith(target.path)))
    }
  }
})

test('missing, duplicated, and unsupported operation contracts fail closed', () => {
  const surface = E2E_UI_SURFACES[1]
  const first = E2E_UI_PROFILES.auth[0][0]
  assert.throws(() => apply(surface, 'ru', source(surface.path).replace(first, '/changed/i')))
  assert.throws(() => apply(surface, 'ru', `${source(surface.path)}\npage.getByLabel(${first})\n`))
  const registry = createProjectStructuralRegistry()
  assert.throws(
    () => planStructuralComposition(registry, [fact(surface, 'de')]),
    (error) =>
      error instanceof PathAlgebraConflictError &&
      error.code === CONFLICT_CODES.INVALID_OPERATION_PARAMS
  )
})
