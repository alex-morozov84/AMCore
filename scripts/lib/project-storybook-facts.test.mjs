import assert from 'node:assert/strict'
import { after, describe, test } from 'node:test'

import { buildProjectFactPlan } from './project-fact-plan.mjs'
import { buildProjectStorybookFacts } from './project-storybook-facts.mjs'
import { createRealRepoCopy } from './test-fixture.mjs'

const copy = createRealRepoCopy()
after(() => copy.cleanup())

function flags(locale, routeProgress, consoleMode) {
  return {
    storybook: 'disabled',
    ...(locale ? { mode: 'single', locale } : {}),
    ...(routeProgress ? { 'route-progress': 'disabled' } : {}),
    ...(consoleMode ? { 'admin-console': consoleMode } : {}),
  }
}

describe('Storybook desired-state facts', () => {
  test('exist only when Storybook is selected and contain no scenario names', () => {
    const off = buildProjectStorybookFacts(
      copy.root,
      buildProjectFactPlan(copy.root, { 'route-progress': 'disabled' }, 'admin').desiredState
    )
    assert.deepEqual(off.facts, [])

    const facts = buildProjectFactPlan(copy.root, { storybook: 'disabled' }, 'admin').storybookFacts
    assert.ok(facts.length > 0)
    assert.equal(JSON.stringify(facts).includes('coverage-'), false)
    assert.equal(JSON.stringify(facts).includes('storybook-disabled-install-before'), false)
  })

  test('all 24 compositions use one stable set of Storybook operation keys', () => {
    let expected
    for (const locale of [undefined, 'en', 'ru']) {
      for (const routeProgress of [false, true]) {
        for (const consoleMode of [undefined, 'disabled', 'path', 'host']) {
          const plan = buildProjectFactPlan(
            copy.root,
            flags(locale, routeProgress, consoleMode),
            'panel'
          )
          const keys = plan.storybookFacts
            .filter((fact) => fact.kind === 'content')
            .map((fact) => fact.operationKey)
            .sort()
          expected ??= keys
          assert.deepEqual(keys, expected)
        }
      }
    }
  })
})
