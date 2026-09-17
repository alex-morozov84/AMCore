import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'

import { prepareProjectInit } from './project-init-plan.mjs'

const root = process.cwd()
const slug = 'ops'

function flags(locale, storybook, routeProgress, consoleMode) {
  const result = { mode: 'single', locale }
  if (storybook) result.storybook = 'disabled'
  if (routeProgress) result['route-progress'] = 'disabled'
  if (consoleMode !== 'default') result['admin-console'] = consoleMode
  return result
}

function operationKeys(plan) {
  return [
    ...new Set(plan.localeFacts.flatMap((fact) => (fact.operationKey ? [fact.operationKey] : []))),
  ].sort()
}

function assertCurrentTreePlan(plan, expectedKeys) {
  assert.deepEqual(operationKeys(plan), expectedKeys)
  assert.deepEqual(plan.legacySteps, [])
  assert.ok(
    plan.localeSteps.every(
      (step) =>
        step.modulePath === 'scripts/lib/project-locale-materializer.mjs' &&
        step.adapterClass !== 'whole-file-legacy-before-after'
    )
  )
  assert.ok(plan.steps.every((step) => !step.modulePath?.startsWith('scripts/lib/project-plan-')))
  assert.ok(
    plan.operationPlan
      .operationsForApply()
      .every((operation) => !path.isAbsolute(operation.target ?? operation.to))
  )
}

test('portable current-tree contract covers all 32 locale compositions', () => {
  let expectedKeys
  let combinations = 0
  for (const locale of ['en', 'ru']) {
    for (const storybook of [false, true]) {
      for (const routeProgress of [false, true]) {
        for (const consoleMode of ['default', 'disabled', 'path', 'host']) {
          const plan = prepareProjectInit(
            root,
            flags(locale, storybook, routeProgress, consoleMode),
            slug
          )
          expectedKeys ??= operationKeys(plan)
          assertCurrentTreePlan(plan, expectedKeys)
          combinations += 1
        }
      }
    }
  }
  assert.equal(combinations, 32)
})
