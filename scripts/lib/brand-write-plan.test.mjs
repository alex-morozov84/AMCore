import assert from 'node:assert/strict'
import { symlinkSync } from 'node:fs'
import { afterEach, describe, it } from 'node:test'

import { createTransactionFixture, writeFixture } from './filesystem-transaction-test-helpers.mjs'
import { buildBrandWritePlan } from './brand-write-plan.mjs'

let fixture
afterEach(() => fixture?.cleanup())

function edit(target, after) {
  return { kind: 'edit', target, before: 'before', after, changed: true, summary: 'edit' }
}

describe('brand write plan', () => {
  it('snapshots supported writes and preserves destination modes', () => {
    fixture = createTransactionFixture()
    const first = writeFixture(fixture.root, 'PROJECT_CONTEXT.md', 'before', 0o640)
    const second = writeFixture(fixture.root, 'package.json', 'before', 0o600)
    const plan = buildBrandWritePlan({
      root: fixture.root,
      materializedSteps: [edit(first, 'one'), edit(second, 'two')],
    })
    const operations = plan.operationsForApply()
    assert.deepEqual(
      operations.map((operation) => operation.target),
      ['PROJECT_CONTEXT.md', 'package.json']
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
        buildBrandWritePlan({
          root: fixture.root,
          materializedSteps: [edit('/tmp/outside.txt', 'no')],
        }),
      /escapes the repository root/
    )
  })

  it('rejects unknown destinations and moves', () => {
    fixture = createTransactionFixture()
    const target = writeFixture(fixture.root, 'unknown.txt', 'before')
    const build = (step) => buildBrandWritePlan({ root: fixture.root, materializedSteps: [step] })
    assert.throws(() => build(edit(target, 'after')), /Unknown brand destination/)
    assert.throws(() => build({ ...edit(target, 'after'), source: target }), /Unsupported brand/)
  })

  it('rejects a symbolic link as a destination', () => {
    fixture = createTransactionFixture()
    const source = writeFixture(fixture.root, 'source.txt', 'before')
    const target = `${fixture.root}/package.json`
    symlinkSync(source, target)
    assert.throws(
      () => buildBrandWritePlan({ root: fixture.root, materializedSteps: [edit(target, 'after')] }),
      /brand destination must be a regular file/
    )
  })

  it('rejects duplicate effective writers before M4', () => {
    fixture = createTransactionFixture()
    const target = writeFixture(fixture.root, 'package.json', 'before')
    assert.throws(
      () =>
        buildBrandWritePlan({
          root: fixture.root,
          materializedSteps: [edit(target, 'one'), edit(target, 'two')],
        }),
      /Duplicate brand destination/
    )
  })
})
