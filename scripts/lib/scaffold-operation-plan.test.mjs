import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { createTransactionFixture, writeFixture } from './filesystem-transaction-test-helpers.mjs'
import { buildScaffoldOperationPlan } from './scaffold-operation-plan.mjs'

let fixture
afterEach(() => fixture?.cleanup())

function edit(target, after) {
  return { kind: 'edit', target, before: 'before', after, changed: true, summary: 'edit' }
}

describe('scaffold operation plan', () => {
  it('reduces materialized edits into one immutable M4 operation array', () => {
    fixture = createTransactionFixture()
    const first = writeFixture(fixture.root, 'first.txt', 'before', 0o640)
    const second = writeFixture(fixture.root, 'second.txt', 'before', 0o600)
    const plan = buildScaffoldOperationPlan({
      root: fixture.root,
      materializedSteps: [edit(first, 'one'), edit(second, 'two')],
    })
    const operations = plan.operationsForApply()
    assert.deepEqual(
      operations.map((operation) => operation.target),
      ['first.txt', 'second.txt']
    )
    assert.deepEqual(
      operations.map((operation) => operation.mode),
      [0o640, 0o600]
    )
    operations[0].bytes.fill(0)
    assert.equal(plan.operationsForApply()[0].bytes.toString(), 'one')
  })

  it('rejects a target outside the transaction root', () => {
    fixture = createTransactionFixture()
    assert.throws(
      () =>
        buildScaffoldOperationPlan({
          root: fixture.root,
          materializedSteps: [edit('/tmp/outside.txt', 'no')],
        }),
      /escapes the transaction root/
    )
  })

  it('keeps the established destination mode for a move with rewritten content', () => {
    fixture = createTransactionFixture()
    const source = writeFixture(fixture.root, 'source.txt', 'before', 0o640)
    const target = `${fixture.root}/moved.txt`
    const plan = buildScaffoldOperationPlan({
      root: fixture.root,
      materializedSteps: [{ ...edit(target, 'after'), source }],
    })
    const [operation] = plan.operationsForApply()
    assert.equal(operation.kind, 'move')
    assert.equal(operation.mode, 0o666 & ~process.umask())
  })

  it('rejects duplicate effective writers before M4', () => {
    fixture = createTransactionFixture()
    const target = writeFixture(fixture.root, 'shared.txt', 'before')
    assert.throws(
      () =>
        buildScaffoldOperationPlan({
          root: fixture.root,
          materializedSteps: [edit(target, 'one'), edit(target, 'two')],
        }),
      /duplicate writer/
    )
  })
})
