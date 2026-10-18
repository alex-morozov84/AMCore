import assert from 'node:assert/strict'
import { existsSync, readFileSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { applyFilesystemTransaction } from './filesystem-transaction.mjs'
import { prepareProjectInit } from './project-init-plan.mjs'
import { assertManagedStandProjection } from './scaffold-managed-stand-assertions.mjs'
import { createWorkingTreeCopy } from './working-tree-fixture.mjs'

const stories = [
  'apps/web/src/features/console-organization-provisioning/ui/organization-provisioning.stories.tsx',
  'apps/web/src/features/console-organization-provisioning/ui/provisioning-management.stories.tsx',
  'apps/web/src/features/console-organization-administration/ui/organization-administration.stories.tsx',
]
const retained = [
  'apps/api/src/core/organizations/provisioning/provisioning.controller.ts',
  'apps/api/src/core/organizations/administration/administration.controller.ts',
  'apps/api/src/cli/organization-setup.ts',
  'apps/api/prisma/organization-provisioning.prisma',
  'apps/api/prisma/organization-administrator-invitation.prisma',
  'apps/api/prisma/migrations/20261016190000_organization_provisioning/migration.sql',
  'apps/api/prisma/migrations/20261017150000_organization_administrator_invitations/migration.sql',
  'apps/web/src/_pages/invitation-recipient/index.ts',
  'apps/web/src/features/invitation-acceptance/index.ts',
  'docs/product-admin/organization-provisioning.md',
  'docs/product-admin/organization-administration.md',
  'docs/product-admin/organization-provisioning-responses.md',
  'docs/frontend/ux-checklist.md',
  'docs/documentation-guide.md',
]
const removed = [
  'apps/web/src/features/console-organization-provisioning',
  'apps/web/src/features/console-organization-administration',
  'apps/web/src/app/api/console',
  'apps/web/src/_pages/console',
  'apps/web/src/shared/api/console',
  'apps/web/e2e/organization-provisioning',
]

for (const locale of ['en', 'ru']) {
  for (const enabled of [true, false]) {
    test(`B07 single-${locale}, Console ${enabled ? 'retained' : 'disabled'} preserves backend and recipient`, async () => {
      const copy = createWorkingTreeCopy()
      try {
        const flags = {
          mode: 'single',
          locale,
          ...(enabled
            ? {}
            : {
                'admin-console': 'disabled',
                storybook: 'disabled',
              }),
        }
        const plan = prepareProjectInit(copy.root, flags, 'admin')
        applyFilesystemTransaction({
          root: copy.root,
          operations: plan.operationPlan.operationsForApply(),
        })
        plan.assertApplied()
        const read = (p) => readFileSync(join(copy.root, p), 'utf8')
        for (const p of retained) assert.ok(existsSync(join(copy.root, p)), p)
        for (const p of removed) assert.equal(existsSync(join(copy.root, p)), enabled, p)
        const messages = JSON.parse(read(`apps/web/messages/${locale}.json`))
        assert.equal(Boolean(messages.console), enabled)
        assert.ok(messages.invitationRecipient)
        assert.ok(messages.organizationCreation)
        for (const p of ['organization-provisioning', 'organization-administration']) {
          const guide = read(`docs/product-admin/${p}.md`)
          assert.equal(guide.includes('## Use Console'), enabled)
          assert.match(guide, /## Installation without Console|## Use the backend without Console/)
          assert.match(guide, /expiredUnrecorded/)
          assert.match(guide, /operationId/)
          assert.match(guide, /SUPER_ADMIN/)
          if (!enabled)
            assert.doesNotMatch(
              guide,
              /Choose \*\*(?:Send a new invitation|Change recipient|Enter recipient|Invite an administrator)\*\*|Console's general organization search|Console then|Console shows the translated refusal|Close the confirmation|The assignment confirmation warns|Find the organization in the inventory/
            )
        }
        assert.match(
          read('docs/product-admin/organization-administration.md'),
          /pendingAdminInvitationCount/
        )
        assert.match(
          read('docs/product-admin/organization-administration.md'),
          /A headless client may read/
        )
        if (enabled) {
          for (const p of stories) {
            assert.ok(read(p).includes(`messages/${locale}.json`))
            assert.ok(!read(p).includes(`messages/${locale === 'en' ? 'ru' : 'en'}.json`))
          }
        } else {
          assert.doesNotMatch(
            read('apps/web/playwright.real-stack.config.ts'),
            /e2e\/organization-provisioning/
          )
          assert.doesNotMatch(read('docs/operations/local-stands.md'), /console-real-stack/)
        }
        for (const p of ['organization-provisioning', 'organization-administration']) {
          assert.match(
            read(`packages/shared/src/schemas/${p}.ts`),
            /z\.enum\(SUPPORTED_LOCALES\)\.default\(DEFAULT_LOCALE\)/
          )
        }
        symlinkSync(join(process.cwd(), 'node_modules'), join(copy.root, 'node_modules'), 'dir')
        await assertManagedStandProjection(copy.root, {
          factors: {
            console: enabled ? 'path' : 'disabled',
            locales: [locale],
          },
        })
      } finally {
        copy.cleanup()
      }
    })
  }
}
