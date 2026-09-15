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

describe('nine-path shared semantic owner', () => {
  it('materializes the same shared bytes in fact and executable plans', () => {
    for (const locale of locales) {
      for (const storybook of [false, true]) {
        for (const routeProgress of [false, true]) {
          for (const console of consoles) {
            if (!locale && !storybook && !routeProgress && !console) continue
            const flags = flagsFor(locale, storybook, routeProgress, console)
            const slug = console === 'path' || console === 'host' ? 'panel' : 'admin'
            const expected = buildProjectFactPlan(copy.root, flags, slug).sharedContentSteps
            const actual = new Map(
              prepareProjectInit(copy.root, flags, slug).steps.map((step) => [step.target, step])
            )
            for (const step of expected) {
              const executable = actual.get(step.target)
              assert.ok(executable, `${step.target}: missing executable step`)
              assert.equal(step.kind, executable.kind, step.target)
              if (step.kind === 'edit') assert.equal(step.after, executable.after, step.target)
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

  it('deduplicates an identical semantic location and canonical value', () => {
    const fact = {
      kind: 'content',
      dimension: 'a',
      path: 'PROJECT_CONTEXT.md',
      operationKey: 'context-route-progress',
      params: {},
    }
    const single = materializeProjectContentPath(copy.root, fact.path, [fact])
    const duplicate = materializeProjectContentPath(copy.root, fact.path, [
      fact,
      { ...fact, dimension: 'b' },
    ])
    assert.equal(duplicate.after, single.after)
  })

  it('builds the same plan and output metadata for either CLI flag order', () => {
    const entries = [
      ['mode', 'single'],
      ['locale', 'ru'],
      ['storybook', 'disabled'],
      ['route-progress', 'disabled'],
      ['admin-console', 'disabled'],
    ]
    const forward = prepareProjectInit(copy.root, Object.fromEntries(entries), 'admin')
    const reverse = prepareProjectInit(copy.root, Object.fromEntries(entries.reverse()), 'admin')
    assert.deepEqual(reverse.steps, forward.steps)
    assert.deepEqual(
      reverse.operationPlan.operationsForApply(),
      forward.operationPlan.operationsForApply()
    )
    assert.equal(reverse.confirmMessage, forward.confirmMessage)
  })
})
