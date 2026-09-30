import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { applyFilesystemTransaction } from './filesystem-transaction.mjs'
import { prepareProjectInit } from './project-init-plan.mjs'
import { createWorkingTreeCopy } from './working-tree-fixture.mjs'
import { createProjectStructuralRegistry } from './project-content-materializer.mjs'
import {
  applyStructuralPlan,
  planStructuralComposition,
} from './path-algebra-structural-compose.mjs'

const pathname = 'apps/web/src/_pages/settings/SessionsPage/SessionsTable.test.tsx'
for (const locale of ['en', 'ru']) {
  test(`Sessions assertions survive actual single-${locale} Console-disabled projection`, () => {
    const copy = createWorkingTreeCopy(process.cwd())
    try {
      const plan = prepareProjectInit(
        copy.root,
        { mode: 'single', locale, 'admin-console': 'disabled' },
        'admin'
      )
      applyFilesystemTransaction({
        root: copy.root,
        operations: plan.operationPlan.operationsForApply(),
      })
      plan.assertApplied()
      const web = readFileSync(path.join(copy.root, pathname), 'utf8')
      assert.match(web, new RegExp(`name: ${locale}\\.sessions\\.createdAt`))
      assert.doesNotMatch(web, /Latest token issued/)
      assert.match(web, /toHaveLength\(1\)/)
      assert.match(web, new RegExp(`messages/${locale}\\.json`))
      const api = readFileSync(
        path.join(copy.root, 'apps/api/src/core/auth/auth.controller.spec.ts'),
        'utf8'
      )
      assert.equal(api.match(/ {8}DEFAULT_LOCALE/g)?.length, 3)
      assert.match(api, /SUPPORTED_LOCALES\.at\(-1\) \?\? DEFAULT_LOCALE/)
      assert.match(api, /'current-hashed-token',\s+1,\s+20,\s+DEFAULT_LOCALE/)
    } finally {
      copy.cleanup()
    }
  })
}

test('Sessions catalogue label adaptation rejects missing and duplicate assertion targets', () => {
  const source = readFileSync(pathname, 'utf8')
  const registry = createProjectStructuralRegistry()
  const [plan] = planStructuralComposition(registry, [
    {
      kind: 'structural',
      dimension: 'locale',
      path: pathname,
      operationKey: 'locale.catalogue-fixture',
      params: { locale: 'ru', variant: 'sessions' },
    },
  ])
  assert.throws(() =>
    applyStructuralPlan(registry, plan, source.replace('en.sessions.createdAt', "'removed'"))
  )
  assert.throws(() =>
    applyStructuralPlan(registry, plan, `${source}\nconst duplicate = en.sessions.createdAt\n`)
  )
})
