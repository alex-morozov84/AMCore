import assert from 'node:assert/strict'
import path from 'node:path'
import { after, test } from 'node:test'

import { buildProjectLegacySteps } from './project-legacy-provider.mjs'
import { SHARED_CONTENT_PATHS } from './project-shared-content-facts.mjs'
import { createRealRepoCopy } from './test-fixture.mjs'

const copy = createRealRepoCopy()
after(() => copy.cleanup())

function flags(locale, storybook, routeProgress, console) {
  return {
    ...(locale ? { mode: 'single', locale } : {}),
    ...(storybook ? { storybook: 'disabled' } : {}),
    ...(routeProgress ? { 'route-progress': 'disabled' } : {}),
    ...(console ? { 'admin-console': console } : {}),
  }
}

function matrix() {
  const combinations = []
  for (const locale of [undefined, 'en', 'ru']) {
    for (const storybook of [false, true]) {
      for (const routeProgress of [false, true]) {
        for (const console of [undefined, 'disabled', 'path', 'host']) {
          if (locale || storybook || routeProgress || console) {
            combinations.push(flags(locale, storybook, routeProgress, console))
          }
        }
      }
    }
  }
  return combinations
}

function relative(target) {
  return path.relative(copy.root, target).split(path.sep).join('/')
}

test('legacy provider emits zero steps or seeds for all nine shared paths', () => {
  const shared = new Set(SHARED_CONTENT_PATHS)
  for (const selected of matrix()) {
    const steps = buildProjectLegacySteps(copy.root, selected, 'panel')
    assert.deepEqual(
      steps.filter((step) => shared.has(relative(step.target))),
      []
    )
  }
})

test('every remaining legacy content target belongs to exactly one provider', () => {
  const owners = new Map()
  for (const selected of matrix()) {
    for (const step of buildProjectLegacySteps(copy.root, selected, 'panel')) {
      if (step.kind !== 'edit' && step.kind !== 'copy') continue
      const targetOwners = owners.get(relative(step.target)) ?? new Set()
      targetOwners.add(step.provider)
      owners.set(relative(step.target), targetOwners)
    }
  }
  assert.ok(owners.size > 0)
  assert.deepEqual(
    [...owners].filter(([, targetOwners]) => targetOwners.size !== 1),
    []
  )
})
