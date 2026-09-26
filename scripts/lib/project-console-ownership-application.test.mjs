import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
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
    for (const file of [
      'apps/web/src/features/console-user-sessions',
      'apps/web/src/shared/lib/console-step-up-mutation.ts',
      'apps/web/src/shared/ui/console-step-up-dialog.tsx',
      'apps/web/src/shared/ui/console-step-up-dialog.test.tsx',
      'apps/web/src/shared/api/console/session-metadata.test.ts',
      'apps/web/e2e/real-stack/admin-sessions/sessions.spec.ts',
    ])
      assert.equal(existsSync(path.join(root, file)), false, file)
    for (const file of [
      'apps/api/src/core/admin/admin-sessions.service.ts',
      'apps/api/src/infrastructure/geoip/geoip.service.ts',
      'packages/shared/src/schemas/admin-session.ts',
      'apps/web/src/shared/lib/format-session.ts',
      'apps/web/src/shared/lib/use-clamp-page.ts',
      'apps/web/src/shared/ui/pagination.tsx',
      'apps/web/src/_pages/settings/SessionsPage/SessionsTable.tsx',
      'apps/web/src/shared/api/bff/session-refresh-callers.test.ts',
    ])
      assert.equal(existsSync(path.join(root, file)), true, file)
    const sessions = readFileSync(path.join(root, 'docs/auth/sessions.md'), 'utf8')
    assert.match(sessions, /GET \/api\/v1\/admin\/users\/:id\/sessions/)
    assert.doesNotMatch(sessions, /operations-console|Operations Console/)
    assert.match(sessions, /geoip-setup\.md/)
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
