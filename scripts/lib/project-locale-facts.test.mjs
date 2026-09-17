import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseProjectFlags } from './project-flags.mjs'
import { buildProjectLocaleFacts } from './project-locale-facts.mjs'
import { buildProjectSharedContentFacts } from './project-shared-content-facts.mjs'

const state = (locale, selected = true, extras = {}) => ({
  selected: {
    locale: selected,
    storybook: extras.storybook ?? false,
    routeProgress: extras.routeProgress ?? false,
    adminConsole: extras.adminConsole ?? false,
  },
  locale: { mode: selected ? 'single' : 'multi', base: locale },
})

const operationKeys = (facts) =>
  [...new Set(facts.flatMap((fact) => (fact.operationKey ? [fact.operationKey] : [])))].sort()

test('emits locale facts only when single-locale mode was selected', () => {
  assert.deepEqual(buildProjectLocaleFacts(state('en', false)), [])
  assert.ok(buildProjectLocaleFacts(state('en')).length > 0)
})

test('encodes the selected catalogue, route moves, and ancestor cleanup', () => {
  for (const locale of ['en', 'ru']) {
    const facts = buildProjectLocaleFacts(state(locale))
    const shared = buildProjectSharedContentFacts(state(locale))
    assert.ok(facts.some((fact) => fact.params?.locale === locale))
    assert.ok(facts.some((fact) => fact.kind === 'move' && fact.from.includes('/[locale]/')))
    assert.ok(facts.some((fact) => fact.kind === 'delete' && fact.path.endsWith('/[locale]')))
    assert.ok(
      shared.some(
        (fact) =>
          fact.kind === 'delete' &&
          fact.path === `apps/web/messages/${locale === 'en' ? 'ru' : 'en'}.json`
      )
    )
  }
})

test('contains no scenario or CLI-order vocabulary', () => {
  const serialized = JSON.stringify(buildProjectLocaleFacts(state('en')))
  assert.doesNotMatch(serialized, /scenario|flagOrder|combined/i)
})

test('keeps one operation-key set across all 32 composed combinations', () => {
  let expected
  let combinations = 0
  for (const locale of ['en', 'ru']) {
    for (const storybook of [false, true]) {
      for (const routeProgress of [false, true]) {
        for (const adminConsole of [false, true, 'host', 'disabled']) {
          const keys = operationKeys(
            buildProjectLocaleFacts(state(locale, true, { storybook, routeProgress, adminConsole }))
          )
          expected ??= keys
          assert.deepEqual(keys, expected)
          combinations += 1
        }
      }
    }
  }
  assert.equal(combinations, 32)
})

test('parses project flags independently of their CLI order', () => {
  const left = parseProjectFlags([
    '--mode=single',
    '--locale=ru',
    '--storybook=disabled',
    '--route-progress=disabled',
  ])
  const right = parseProjectFlags([
    '--route-progress=disabled',
    '--storybook=disabled',
    '--locale=ru',
    '--mode=single',
  ])
  assert.deepEqual(left, right)
})
