import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { applyFilesystemTransaction } from './filesystem-transaction.mjs'
import { assertMemberRemovalProjection } from './member-removal-projection-assertions.mjs'
import { prepareProjectInit } from './project-init-plan.mjs'
import { createWorkingTreeCopy } from './working-tree-fixture.mjs'

const scenarios = [
  ['single-en', { mode: 'single', locale: 'en' }],
  ['single-ru', { mode: 'single', locale: 'ru' }],
  ['console-disabled', { 'admin-console': 'disabled' }],
  ['storybook-disabled', { storybook: 'disabled' }],
  [
    'host-route-off',
    { 'admin-console': 'host', 'admin-console-slug': 'panel', 'route-progress': 'disabled' },
  ],
  [
    'combined-ru',
    {
      mode: 'single',
      locale: 'ru',
      'admin-console': 'disabled',
      storybook: 'disabled',
      'route-progress': 'disabled',
    },
  ],
]
for (const [name, flags] of scenarios) {
  test(`member public routes and headless seams survive ${name}`, () => {
    const copy = createWorkingTreeCopy()
    try {
      const plan = prepareProjectInit(copy.root, flags, 'admin')
      applyFilesystemTransaction({
        root: copy.root,
        operations: plan.operationPlan.operationsForApply(),
      })
      plan.assertApplied()
      const read = (file) => readFileSync(path.join(copy.root, file), 'utf8')
      const exists = (file) => existsSync(path.join(copy.root, file))
      assertMemberRemovalProjection({ read, exists, flags })
      const prefix = flags.mode === 'single' ? '' : '[locale]/'
      assert.ok(
        exists(
          `apps/web/src/app/${prefix}(product-admin)/manage/(protected)/organizations/[id]/members/page.tsx`
        )
      )
      assert.ok(exists('apps/web/src/app/api/product-access/organizations/[id]/members/route.ts'))
      assert.ok(
        exists(
          `apps/web/src/app/${prefix}(product-admin)/manage/(protected)/organizations/[id]/invites/page.tsx`
        )
      )
      for (const route of [
        'accept/route.ts',
        'bootstrap/[pendingId]/route.ts',
        'flow/[flowId]/page.tsx',
        'flow/[flowId]/loading.tsx',
        'unusable/page.tsx',
      ]) {
        assert.ok(exists(`apps/web/src/app/${prefix}(auth)/invite/${route}`), route)
      }
      assert.ok(exists('apps/web/src/entities/organization-context/api/invitations-client.ts'))
      assert.match(
        read('apps/web/src/entities/organization-context/index.ts'),
        /useMemberRoleAssignments/
      )
      assert.match(
        read('apps/web/src/entities/organization-context/index.ts'),
        /useOrganizationMembers/
      )
      assert.ok(
        exists('apps/web/src/app/api/product-access/organizations/[id]/members/[userId]/route.ts')
      )
      assert.match(read('apps/web/src/entities/organization-context/index.ts'), /useMemberRemoval/)
      assert.match(
        read('apps/web/src/entities/organization-context/index.server.ts'),
        /removeOrganizationMember/
      )
      assert.ok(exists('apps/web/src/entities/organization-context/model/member-removal/hooks.ts'))
      assert.ok(exists('apps/web/src/features/member-removal/ui/member-removal.tsx'))
      assert.match(read('docs/product-admin/organization-members.md'), /expectedMemberId/)
      const keyRoot =
        'apps/web/src/app/api/product-access/organizations/[id]/members/[userId]/api-keys'
      for (const route of ['route.ts', 'revoke-all/route.ts', '[keyId]/revoke/route.ts'])
        assert.ok(exists(`${keyRoot}/${route}`), route)
      assert.match(read('apps/web/src/entities/organization-context/index.ts'), /useMemberApiKeys/)
      assert.match(
        read('apps/web/src/entities/organization-context/index.server.ts'),
        /readMemberKeys, revokeMemberKeys/
      )
      for (const file of ['hooks.ts', 'hooks.test.tsx'])
        assert.ok(
          exists(`apps/web/src/entities/organization-context/model/member-api-keys/${file}`)
        )
      for (const file of [
        'member-api-keys-dialog.tsx',
        'member-api-keys-host.tsx',
        'member-key-list.tsx',
        'member-key-skeleton.tsx',
      ])
        assert.ok(exists(`apps/web/src/features/member-api-keys/ui/${file}`))
      assert.equal(
        exists('apps/web/src/features/member-api-keys/ui/member-api-keys.stories.tsx'),
        flags.storybook !== 'disabled'
      )
      assert.ok(exists('apps/api/src/core/organizations/member-api-keys/member-key.controller.ts'))
      assert.match(
        read('packages/shared/src/schemas/member-api-keys.ts'),
        /MEMBER_KEY_ALL_LIMIT = 1000/
      )
      for (const locale of flags.mode === 'single' ? [flags.locale] : ['en', 'ru']) {
        const messages = JSON.parse(read(`apps/web/messages/${locale}.json`))
        assert.ok(messages.memberRemoval.warning)
        assert.ok(messages.memberRemoval.confirm)
        assert.ok(messages.memberApiKeys.confirmAll)
        assert.ok(messages.memberApiKeys.membership_removed)
      }
      for (const doc of [
        'docs/product-admin/member-api-keys.md',
        'docs/operations/api-key-lifecycle.md',
      ]) {
        for (const match of read(doc).matchAll(/\]\(([^)\s]+)\)/g)) {
          const target = match[1].split('#')[0]
          if (!target || target.includes('://') || target.startsWith('/')) continue
          assert.ok(exists(path.join(path.dirname(doc), target)), `${name}: ${doc} -> ${target}`)
        }
      }
      for (const module of [
        'filter-panel',
        'data-table-surface',
        'list-pagination',
        'role-badges',
        'tooltip',
      ])
        assert.ok(exists(`apps/web/src/shared/ui/${module}.tsx`))
      if (flags['admin-console'] === 'disabled') {
        assert.equal(exists('apps/web/src/_pages/console'), false)
        assert.ok(exists('apps/web/src/widgets/organization-members/ui/member-table.tsx'))
      }
      if (flags.mode === 'single') {
        const catalog = JSON.parse(read(`apps/web/messages/${flags.locale}.json`))
        assert.ok(catalog.organizationMembers.roleList)
        assert.ok(catalog.organizationMembers.noDescription)
      }
      if (flags.storybook === 'disabled')
        assert.equal(
          exists('apps/web/src/features/member-role-assignment/ui/role-choices.stories.tsx'),
          false
        )
    } finally {
      copy.cleanup()
    }
  })
}
