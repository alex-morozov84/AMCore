import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { applyFilesystemTransaction, FilesystemApplyError } from './filesystem-transaction.mjs'
import {
  assertNoTransactionArtifacts,
  filesystemSnapshot,
} from './filesystem-transaction-test-helpers.mjs'
import { prepareProjectInit } from './project-init-plan.mjs'
import { createRealRepoCopy } from './test-fixture.mjs'

function withCopy(run) {
  const copy = createRealRepoCopy()
  try {
    return run(copy.root)
  } finally {
    copy.cleanup()
  }
}

test('disabled projection applies once and passes the residual scan', () =>
  withCopy((root) => {
    const plan = prepareProjectInit(root, { 'admin-console': 'disabled' }, 'admin')
    const result = applyFilesystemTransaction({
      root,
      operations: plan.operationPlan.operationsForApply(),
    })
    plan.assertApplied()
    assert.equal(result.applied, plan.operationPlan.operationCount)
    assert.equal(existsSync(path.join(root, 'apps/web/src/app/[locale]/admin')), false)
    assert.equal(existsSync(path.join(root, 'docs/operations-console')), false)
    assertNoTransactionArtifacts(root)
  }))

test('injected all-dimensions failure restores the full tree', () =>
  withCopy((root) => {
    const flags = {
      mode: 'single',
      locale: 'ru',
      storybook: 'disabled',
      'route-progress': 'disabled',
      'admin-console': 'disabled',
    }
    const plan = prepareProjectInit(root, flags, 'admin')
    const before = filesystemSnapshot(root)
    const operations = plan.operationPlan.operationsForApply()
    assert.throws(
      () =>
        applyFilesystemTransaction({
          root,
          operations,
          hooks: {
            afterMutation: ({ index }) => {
              if (index === Math.floor(operations.length / 2)) throw new Error('injected')
            },
          },
        }),
      (error) => error instanceof FilesystemApplyError && error.restored
    )
    assert.deepEqual(filesystemSnapshot(root), before)
    assertNoTransactionArtifacts(root)
  }))
