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
import { createWorkingTreeCopy } from './working-tree-fixture.mjs'

function withCopy(run) {
  const copy = createWorkingTreeCopy()
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
      'apps/web/src/features/console-organization-setup',
      'apps/web/src/app/api/console/organization-establishment',
      'apps/web/e2e/organization-setup/console-organization-setup.spec.ts',
      'apps/web/src/shared/lib/console-step-up-mutation.ts',
      'apps/web/src/shared/ui/console-step-up-dialog.tsx',
      'apps/web/src/shared/ui/console-step-up-dialog.test.tsx',
      'apps/web/src/shared/api/console/session-metadata.test.ts',
      'apps/web/e2e/real-stack/admin-sessions/sessions.spec.ts',
    ])
      assert.equal(existsSync(path.join(root, file)), false, file)
    for (const file of [
      'apps/api/src/core/admin/admin-sessions.service.ts',
      'apps/api/src/core/admin/organization-establishment.controller.ts',
      'apps/api/src/cli/organization-setup.ts',
      'apps/web/src/features/organization-create',
      'apps/web/src/app/api/product-access/organizations/creation-policy/route.ts',
      'apps/web/e2e/organization-setup/organization-initial-setup.spec.ts',
      'apps/web/e2e/support/organization-setup.ts',
      'scripts/stand/setup-command.mjs',
      'scripts/stand/setup-mail-collector.mjs',
      'apps/api/src/infrastructure/geoip/geoip.service.ts',
      'packages/shared/src/schemas/admin-session.ts',
      'apps/web/src/shared/lib/format-session.ts',
      'apps/web/src/shared/lib/use-clamp-page.ts',
      'apps/web/src/shared/ui/pagination.tsx',
      'apps/web/src/_pages/settings/SessionsPage/SessionsTable.tsx',
      'apps/web/src/shared/api/bff/session-refresh-callers.test.ts',
    ])
      assert.equal(existsSync(path.join(root, file)), true, file)
    const productAdmin = readFileSync(path.join(root, 'docs/product-admin/README.md'), 'utf8')
    assert.doesNotMatch(productAdmin, /operations-console\/README\.md/)
    assert.match(productAdmin, /placement-and-sessions/)
    const establishment = readFileSync(
      path.join(root, 'docs/product-admin/organization-establishment.md'),
      'utf8'
    )
    assert.doesNotMatch(establishment, /operations-console\/|## Use Console|Change recipient/)
    assert.match(establishment, /node dist\/cli\/organization-setup\.js/)
    assert.match(establishment, /protected initial-setup API also remains/)
    const preview = readFileSync(path.join(root, 'scripts/stand/preview.mjs'), 'utf8')
    assert.doesNotMatch(preview, /establishmentPreviewRecipient|Initial setup preview needs/)
    assert.match(
      readFileSync(path.join(root, 'docker-compose.yml'), 'utf8'),
      /ORG_SELF_SERVICE_CREATION_ENABLED/
    )

    for (const file of [
      'docs/product-admin/integration.md',
      'docs/product-admin/extending-modules.md',
    ])
      assert.ok(existsSync(path.join(root, file)), file)
    const family = readFileSync(path.join(root, 'apps/web/src/_app/product-api/index.ts'), 'utf8')
    assert.match(family, /ORGANIZATION_CONTEXT_FAMILY.*from '@amcore\/shared'/)
    assert.match(family, /productOrganizationFamilies/)
    assert.equal(
      family,
      readFileSync(path.join(process.cwd(), 'apps/web/src/_app/product-api/index.ts'), 'utf8')
    )
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
