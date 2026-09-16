import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { PathAlgebraConflictError } from './path-algebra-errors.mjs'
import {
  applyStructuralPlan,
  planStructuralComposition,
} from './path-algebra-structural-compose.mjs'
import { createProjectStructuralRegistry } from './project-content-materializer.mjs'

const paths = {
  controller: 'apps/api/src/core/auth/auth.controller.spec.ts',
  service: 'apps/api/src/core/auth/auth.service.spec.ts',
  telegram: 'apps/api/src/core/notifications/channels/telegram/telegram-content.spec.ts',
  registry: 'apps/api/src/core/notifications/notification-definition.registry.spec.ts',
}

function source(name) {
  return readFileSync(path.join(process.cwd(), paths[name]), 'utf8')
}

function apply(text, name, locale) {
  const operations = {
    controller: ['locale.auth-controller-typed-fixture', { locale }],
    service: ['locale.auth-service-test', { locale }],
    telegram: ['locale.telegram-content-test', { locale }],
    registry: ['locale.api-fixture', { locale, variant: 'definition-registry' }],
  }
  const registry = createProjectStructuralRegistry()
  const [operationKey, params] = operations[name]
  const [plan] = planStructuralComposition(registry, [
    {
      kind: 'structural',
      dimension: 'locale',
      path: paths[name],
      operationKey,
      params,
    },
  ])
  return applyStructuralPlan(registry, plan, text)
}

test('adapts all four typed fixture surfaces to concrete RU expectations', () => {
  const controller = apply(source('controller'), 'controller', 'ru')
  const service = apply(source('service'), 'service', 'ru')
  const telegram = apply(source('telegram'), 'telegram', 'ru')
  const registry = apply(source('registry'), 'registry', 'ru')
  assert.match(controller, /name: 'Renamed', locale: 'ru'/)
  assert.match(service, /uses the explicit body locale when supplied/)
  assert.doesNotMatch(service, /acceptedLocale: 'en'/)
  assert.doesNotMatch(service, /objectContaining\(\{ locale: 'en' \}\)/)
  assert.match(telegram, /renderTelegram!\(projection, 'ru'\)/)
  assert.match(telegram, /body: '\(ru\)'/)
  assert.doesNotMatch(registry, /'en'/)
  assert.match(registry, /Профиль обновлён/)
})

test('keeps new EN-only operations byte-identical', () => {
  assert.equal(apply(source('controller'), 'controller', 'en'), source('controller'))
  assert.equal(apply(source('telegram'), 'telegram', 'en'), source('telegram'))
})

test('preserves unrelated security assertions and fixture setup', () => {
  const telegram = apply(source('telegram'), 'telegram', 'ru')
  const service = apply(source('service'), 'service', 'ru')
  assert.match(telegram, /not\.toHaveProperty\('secretField'\)/)
  assert.match(telegram, /requires projectExternal/)
  assert.match(service, /DB default applies/)
  assert.match(service, /writes only the supplied fields and invalidates the user cache/)
})

test('fails closed for every missing or duplicated semantic fixture anchor', () => {
  const drifts = {
    controller: ['delegates to the service and returns the wrapped profile', 'drifted'],
    service: [
      'falls back to the negotiated Accept-Language locale when the body omits it',
      'drifted',
    ],
    telegram: [
      'renders detailed content only from the allowlisted projection (no raw payload leak)',
      'drifted',
    ],
    registry: ['renderStored (version-aware, fail-closed)', 'drifted'],
  }
  for (const [name, [anchor, replacement]] of Object.entries(drifts)) {
    assert.throws(() => apply(source(name).replace(anchor, replacement), name, 'ru'), semanticNode)
    const call = name === 'registry' ? 'describe' : 'it'
    const duplicated = `${source(name)}\n${call}(${JSON.stringify(anchor)}, () => {})\n`
    assert.throws(() => apply(duplicated, name, 'ru'), semanticNode)
  }
})

function semanticNode(error) {
  return error instanceof PathAlgebraConflictError
}
