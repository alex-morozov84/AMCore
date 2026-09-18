import assert from 'node:assert/strict'
import { test } from 'node:test'

import { materializeProjectContentPath } from './project-content-materializer.mjs'
import { projectPlan } from './project-composition-matrix-fixture.mjs'
import { prepareProjectInit } from './project-init-plan.mjs'
import { createRealRepoCopy } from './test-fixture.mjs'

function fact(pathname, dimension, operationKey, params = {}) {
  return { kind: 'content', dimension, path: pathname, operationKey, params }
}

function withCopy(run) {
  const copy = createRealRepoCopy()
  try {
    return run(copy.root)
  } finally {
    copy.cleanup()
  }
}

function assertSharedSteps(plan) {
  const actual = new Map(plan.steps.map((step) => [step.target, step]))
  for (const step of plan.sharedContentSteps) {
    const executable = actual.get(step.target)
    assert.ok(executable, `${step.target}: missing executable step`)
    assert.equal(step.kind, executable.kind, step.target)
    if (step.kind === 'edit') assert.equal(step.after, executable.after, step.target)
  }
}

function registerMaterializationAssertions(matrix, snapshots) {
  test('materializes the same shared bytes in fact and executable plans', () => {
    for (const { plan } of matrix.rows) assertSharedSteps(plan)
  })

  test('constructs the complete immutable plan without mutating the tree', () => {
    assert.deepEqual(snapshots.after, snapshots.before)
    assert.ok(matrix.rows.every((row) => Object.isFrozen(row.plan)))
  })
}

function registerSharedContentAssertions() {
  test('fails on conflicting claims before materialization', () => {
    withCopy((copyRoot) => {
      const pathname = 'PROJECT_CONTEXT.md'
      const facts = [
        fact(pathname, 'a', 'context-route-progress'),
        fact(pathname, 'b', 'context-console', { enabled: true, mode: 'path', slug: 'admin' }),
        fact(pathname, 'c', 'context-console', { enabled: false }),
      ]
      assert.throws(
        () => materializeProjectContentPath(copyRoot, pathname, facts),
        /semantic claim conflict/
      )
    })
  })

  test('deduplicates an identical semantic location and canonical value', () => {
    withCopy((copyRoot) => {
      const entry = fact('PROJECT_CONTEXT.md', 'a', 'context-route-progress')
      const single = materializeProjectContentPath(copyRoot, entry.path, [entry])
      const duplicate = materializeProjectContentPath(copyRoot, entry.path, [
        entry,
        { ...entry, dimension: 'b' },
      ])
      assert.equal(duplicate.after, single.after)
    })
  })
}

function registerFlagOrderAssertion(root) {
  test('builds the same plan and output metadata for either CLI flag order', () => {
    const direct = {
      mode: 'single',
      locale: 'ru',
      storybook: 'disabled',
      'route-progress': 'disabled',
      'admin-console': 'disabled',
    }
    const reverse = {
      'admin-console': 'disabled',
      'route-progress': 'disabled',
      storybook: 'disabled',
      locale: 'ru',
      mode: 'single',
    }
    assert.deepEqual(
      projectPlan(prepareProjectInit(root, reverse, 'admin')),
      projectPlan(prepareProjectInit(root, direct, 'admin'))
    )
  })
}

export function registerSharedCompositionAssertions(matrix, root, snapshots) {
  registerMaterializationAssertions(matrix, snapshots)
  registerSharedContentAssertions()
  registerFlagOrderAssertion(root)
}
