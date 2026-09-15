import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { createTransactionFixture, writeFixture } from './filesystem-transaction-test-helpers.mjs'
import { buildScaffoldOperationPlan } from './scaffold-operation-plan.mjs'

let fixture
afterEach(() => fixture?.cleanup())

describe('scaffold operation plan', () => {
  it('forbids an opaque legacy seed on a semantic-owner path', () => {
    fixture = createTransactionFixture()
    const target = writeFixture(fixture.root, 'shared.json', '{}')
    const legacySteps = [{ kind: 'edit', target, before: '{}', after: '{"x":1}', changed: true }]
    assert.throws(
      () =>
        buildScaffoldOperationPlan({
          root: fixture.root,
          legacySteps,
          forbiddenLegacyTargets: ['shared.json'],
        }),
      /opaque legacy step is forbidden/
    )
  })

  it('combines exclusive and semantic steps into one complete immutable plan', () => {
    fixture = createTransactionFixture()
    const legacy = writeFixture(fixture.root, 'legacy.txt', 'before')
    const semantic = writeFixture(fixture.root, 'shared.txt', 'before')
    const plan = buildScaffoldOperationPlan({
      root: fixture.root,
      legacySteps: [
        { kind: 'edit', target: legacy, before: 'before', after: 'legacy', changed: true },
      ],
      semanticSteps: [
        { kind: 'edit', target: semantic, before: 'before', after: 'semantic', changed: true },
      ],
      forbiddenLegacyTargets: ['shared.txt'],
    })
    assert.equal(plan.operationCount, 2)
    assert.deepEqual(
      plan.operationsForApply().map((operation) => operation.target),
      ['legacy.txt', 'shared.txt']
    )
  })

  it('rejects a duplicate step that hides a missing planned step', () => {
    fixture = createTransactionFixture()
    const firstTarget = writeFixture(fixture.root, 'first.txt', 'before')
    const secondTarget = writeFixture(fixture.root, 'second.txt', 'before')
    const first = {
      kind: 'edit',
      target: firstTarget,
      before: 'before',
      after: 'first',
      changed: true,
    }
    const second = {
      kind: 'edit',
      target: secondTarget,
      before: 'before',
      after: 'second',
      changed: true,
    }
    assert.throws(
      () =>
        buildScaffoldOperationPlan({
          root: fixture.root,
          legacySteps: [first, second],
          materializationSteps: [first, first],
        }),
      /complete permutation/
    )
  })
})
