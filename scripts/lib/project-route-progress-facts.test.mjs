import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildProjectFactPlan } from './project-fact-plan.mjs'
import {
  ROUTE_PROGRESS_OPERATION_KEY,
  ROUTE_PROGRESS_SOURCE_PATH,
} from './project-route-progress-ownership.mjs'

const root = process.cwd()

function flags(locale, storybook, adminConsole) {
  return {
    ...(locale ? { mode: 'single', locale } : {}),
    ...(storybook ? { storybook: 'disabled' } : {}),
    'route-progress': 'disabled',
    ...(adminConsole ? { 'admin-console': adminConsole } : {}),
  }
}

test('--route-progress=disabled produces one declarative false-valued source fact', () => {
  const plan = buildProjectFactPlan(root, { 'route-progress': 'disabled' }, 'admin')
  const facts = plan.sharedContentFacts.filter((fact) => fact.path === ROUTE_PROGRESS_SOURCE_PATH)
  assert.deepEqual(facts, [
    {
      kind: 'content',
      dimension: 'route-progress',
      path: ROUTE_PROGRESS_SOURCE_PATH,
      operationKey: ROUTE_PROGRESS_OPERATION_KEY,
      params: { enabled: false },
    },
  ])
  assert.equal(plan.desiredState.routeProgress, 'disabled')
})

test('all 24 route-progress combinations use the same independent adapter', () => {
  let count = 0
  for (const locale of [undefined, 'en', 'ru']) {
    for (const storybook of [false, true]) {
      for (const adminConsole of [undefined, 'disabled', 'path', 'host']) {
        const plan = buildProjectFactPlan(root, flags(locale, storybook, adminConsole), 'panel')
        const fact = plan.sharedContentFacts.find(
          (candidate) => candidate.path === ROUTE_PROGRESS_SOURCE_PATH
        )
        assert.equal(fact.operationKey, ROUTE_PROGRESS_OPERATION_KEY)
        assert.equal(Object.hasOwn(fact, 'scenario'), false)
        assert.ok(
          plan.sharedContentFacts.every(
            (candidate) => !candidate.operationKey?.includes('combined')
          )
        )
        count += 1
      }
    }
  }
  assert.equal(count, 24)
})
