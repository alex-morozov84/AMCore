import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'

import { prepareBrandInit } from './brand-init-plan.mjs'
import { applyFilesystemTransaction } from './filesystem-transaction.mjs'
import { filesystemSnapshot } from './filesystem-transaction-test-helpers.mjs'
import { runInitCommand } from './init-engine.mjs'
import { createFixtureRepo } from './test-fixture.mjs'

let fixture
afterEach(() => fixture?.cleanup())

test('confirmed brand change calls M4 once with the complete plan', async () => {
  fixture = createFixtureRepo()
  const { operationPlan } = prepareBrandInit(fixture.root, {
    productName: 'Acme',
    productDescription: 'Tagline',
    themeMode: 'dark',
  })
  const calls = []
  await runInitCommand({
    cwd: fixture.root,
    flags: { yes: true },
    operationPlan,
    applyFilesystem: (input) => calls.push(input.operations),
    verify: () => [],
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].length, operationPlan.operationCount)
})

test('injected brand apply failure restores the complete filesystem snapshot', () => {
  fixture = createFixtureRepo()
  const before = filesystemSnapshot(fixture.root)
  const { operationPlan } = prepareBrandInit(fixture.root, {
    productName: 'Acme',
    productDescription: 'Tagline',
    themeMode: 'dark',
  })
  assert.throws(
    () =>
      applyFilesystemTransaction({
        root: fixture.root,
        operations: operationPlan.operationsForApply(),
        hooks: {
          afterMutation: ({ index }) => {
            if (index === 2) throw new Error('injected brand failure')
          },
        },
      }),
    /filesystem-apply-failed/
  )
  assert.deepEqual(filesystemSnapshot(fixture.root), before)
})
