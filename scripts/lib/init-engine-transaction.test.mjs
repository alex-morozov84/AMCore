import assert from 'node:assert/strict'
import { test } from 'node:test'

import { runInitCommand } from './init-engine.mjs'
import {
  transactionPlan as plan,
  withTransactionRepo as withRepo,
} from './init-engine-transaction-test-helpers.mjs'

test('dry-run, no-op, and cancellation never invoke M4', async () => {
  await withRepo(async (root) => {
    let calls = 0
    const applyFilesystem = () => {
      calls += 1
    }
    const operation = { kind: 'write', target: 'first.txt', bytes: Buffer.from('after') }
    await runInitCommand({
      cwd: root,
      flags: { 'dry-run': true },
      operationPlan: plan([operation]),
      applyFilesystem,
    })
    await runInitCommand({
      cwd: root,
      flags: { yes: true },
      operationPlan: plan([], false),
      applyFilesystem,
    })
    await runInitCommand({
      cwd: root,
      flags: {},
      operationPlan: plan([operation]),
      applyFilesystem,
      requestConfirmation: async () => false,
    })
    assert.equal(calls, 0)
  })
})

test('confirmed apply passes the complete operation array to M4 exactly once', async () => {
  await withRepo(async (root) => {
    const events = []
    const operations = [
      { kind: 'write', target: 'first.txt', bytes: Buffer.from('one') },
      { kind: 'write', target: 'second.txt', bytes: Buffer.from('two') },
    ]
    await runInitCommand({
      cwd: root,
      flags: { yes: true },
      operationPlan: plan(operations),
      applyFilesystem: (input) => events.push(['apply', input.operations]),
      verify: () => {
        events.push(['verify'])
        return [{ label: 'check', ok: true, output: '' }]
      },
    })
    assert.equal(events.filter(([event]) => event === 'apply').length, 1)
    assert.equal(events[0][1].length, 2)
    assert.deepEqual(
      events.map(([event]) => event),
      ['apply', 'verify']
    )
  })
})
