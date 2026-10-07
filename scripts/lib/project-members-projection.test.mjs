import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { applyFilesystemTransaction } from './filesystem-transaction.mjs'
import { prepareProjectInit } from './project-init-plan.mjs'
import { createWorkingTreeCopy } from './working-tree-fixture.mjs'

const scenarios = [
  ['single-en', { mode: 'single', locale: 'en' }],
  ['single-ru', { mode: 'single', locale: 'ru' }],
  ['console-disabled', { 'admin-console': 'disabled' }],
  ['storybook-disabled', { storybook: 'disabled' }],
  [
    'combined-ru',
    { mode: 'single', locale: 'ru', 'admin-console': 'disabled', storybook: 'disabled' },
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
      const prefix = flags.mode === 'single' ? '' : '[locale]/'
      assert.ok(
        exists(
          `apps/web/src/app/${prefix}(organization-access)/organizations/[id]/members/page.tsx`
        )
      )
      assert.ok(exists('apps/web/src/app/api/product-access/organizations/[id]/members/route.ts'))
      assert.ok(
        exists(
          `apps/web/src/app/${prefix}(organization-access)/organizations/[id]/invites/page.tsx`
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
