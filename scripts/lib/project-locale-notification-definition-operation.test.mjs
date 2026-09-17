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

const root = 'apps/api/src/core/notifications/definitions'
const definitions = [
  ['account-password-changed.definition.ts', 3],
  ['account-profile-updated.definition.ts', 1],
  ['account-telegram-linked.definition.ts', 1],
]

function source(file) {
  return readFileSync(path.join(process.cwd(), root, file), 'utf8')
}

function apply(text, file, locale, englishBranches) {
  const registry = createProjectStructuralRegistry()
  const facts = [
    {
      kind: 'structural',
      dimension: 'locale',
      path: `${root}/${file}`,
      operationKey: 'locale.notification-definition',
      params: { locale, englishBranches },
    },
  ]
  const [plan] = planStructuralComposition(registry, facts)
  return applyStructuralPlan(registry, plan, text)
}

test('keeps EN bytes and collapses only statically impossible RU branches', () => {
  for (const [file, count] of definitions) {
    const input = source(file)
    assert.equal(apply(input, file, 'en', count), input)
    const ru = apply(input, file, 'ru', count)
    assert.doesNotMatch(ru, /locale === 'en'/)
  }
})

test('retains the exact former RU results in all production definitions', () => {
  const output = definitions.map(([file, count]) => apply(source(file), file, 'ru', count))
  const [password, profile, telegram] = output
  assert.match(password, /'ru-RU'/)
  assert.match(password, /title: 'Пароль изменён'/)
  assert.match(password, /title: 'Ваш пароль был изменён'/)
  assert.match(password, /formatChangedAt\(changedAt: string, _locale: SupportedLocale\)/)
  assert.match(password, /renderInApp: \(_payload, _locale\)/)
  assert.match(password, /renderEmail: \(projection, locale\)/)
  assert.match(profile, /title: 'Профиль обновлён'/)
  assert.match(profile, /renderInApp: \(payload, _locale\)/)
  assert.match(telegram, /title: 'Telegram подключён'/)
  assert.match(telegram, /renderInApp: \(_payload, _locale\)/)
})

test('fails closed when an English branch is missing or duplicated', () => {
  const [file, count] = definitions[1]
  const input = source(file)
  const missing = input.replace("locale === 'en'", "locale === 'ru'")
  const duplicate = `${input}\nconst drift = locale === 'en' ? 1 : 2\n`
  assert.throws(() => apply(missing, file, 'ru', count), missingNode)
  assert.throws(() => apply(duplicate, file, 'ru', count), ambiguousNode)
})

function missingNode(error) {
  return (
    error instanceof PathAlgebraConflictError && error.code === CONFLICT_CODES.MISSING_SEMANTIC_NODE
  )
}

function ambiguousNode(error) {
  return (
    error instanceof PathAlgebraConflictError &&
    error.code === CONFLICT_CODES.AMBIGUOUS_SEMANTIC_NODE
  )
}
