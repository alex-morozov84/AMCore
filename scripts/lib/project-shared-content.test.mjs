import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'

import { createRealRepoCopy } from './test-fixture.mjs'
import { prepareProjectInit } from './project-init-plan.mjs'
import { buildProjectFactPlan } from './project-fact-plan.mjs'
import { materializeProjectContentPath } from './project-content-materializer.mjs'
import { filesystemSnapshot } from './filesystem-transaction-test-helpers.mjs'

const copy = createRealRepoCopy()
after(() => copy.cleanup())

const locales = [undefined, 'en', 'ru']
const consoles = [undefined, 'disabled', 'path', 'host']

function flagsFor(locale, storybook, routeProgress, console) {
  return {
    ...(locale ? { mode: 'single', locale } : {}),
    ...(storybook ? { storybook: 'disabled' } : {}),
    ...(routeProgress ? { 'route-progress': 'disabled' } : {}),
    ...(console ? { 'admin-console': console } : {}),
  }
}

function legacySharedByTarget(flags, slug) {
  const { steps } = prepareProjectInit(copy.root, flags, slug)
  return new Map(steps.map((step) => [step.target, step]))
}

describe('nine-path shared semantic owner', () => {
  it('is byte/kind equivalent to legacy composition across the complete dimension matrix', () => {
    for (const locale of locales) {
      for (const storybook of [false, true]) {
        for (const routeProgress of [false, true]) {
          for (const console of consoles) {
            if (!locale && !storybook && !routeProgress && !console) continue
            const flags = flagsFor(locale, storybook, routeProgress, console)
            const slug = console === 'path' || console === 'host' ? 'panel' : 'admin'
            const legacy = legacySharedByTarget(flags, slug)
            const shadow = buildProjectFactPlan(copy.root, flags, slug).sharedContentSteps
            for (const step of shadow) {
              const expected = legacy.get(step.target)
              assert.ok(expected, `${step.target}: missing legacy comparison step`)
              assert.equal(step.kind, expected.kind, step.target)
              if (step.kind === 'edit') assert.equal(step.after, expected.after, step.target)
            }
          }
        }
      }
    }
  })

  it('constructs the complete immutable plan without mutating the tree', () => {
    const before = filesystemSnapshot(copy.root)
    const flags = flagsFor('ru', true, true, 'disabled')
    const plan = buildProjectFactPlan(copy.root, flags, 'admin')
    assert.ok(plan.sharedContentSteps.every((step) => !('write' in step)))
    assert.deepEqual(filesystemSnapshot(copy.root), before)
  })

  it('fails on conflicting claims before materialization', () => {
    const facts = [
      {
        kind: 'content',
        dimension: 'a',
        path: 'PROJECT_CONTEXT.md',
        operationKey: 'context-route-progress',
        params: {},
      },
      {
        kind: 'content',
        dimension: 'b',
        path: 'PROJECT_CONTEXT.md',
        operationKey: 'context-console',
        params: { enabled: true, mode: 'path', slug: 'admin' },
      },
      {
        kind: 'content',
        dimension: 'c',
        path: 'PROJECT_CONTEXT.md',
        operationKey: 'context-console',
        params: { enabled: false },
      },
    ]
    assert.throws(
      () => materializeProjectContentPath(copy.root, 'PROJECT_CONTEXT.md', facts),
      /semantic claim conflict/
    )
  })
})
