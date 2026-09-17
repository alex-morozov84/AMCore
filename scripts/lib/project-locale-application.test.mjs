import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'

import { applyFilesystemTransaction } from './filesystem-transaction.mjs'
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

describe('single-locale filesystem projection', () => {
  for (const locale of ['en', 'ru']) {
    test(`applies the ${locale} topology and ownership projection atomically`, () =>
      withCopy((root) => {
        const plan = prepareProjectInit(root, { mode: 'single', locale }, 'admin')
        const result = applyFilesystemTransaction({
          root,
          operations: plan.operationPlan.operationsForApply(),
        })
        plan.assertApplied()
        assert.equal(result.applied, plan.operationPlan.operationCount)
        assert.equal(existsSync(path.join(root, 'apps/web/src/app/[locale]')), false)
        assert.equal(existsSync(path.join(root, 'apps/web/src/app/layout.tsx')), true)
        assert.equal(existsSync(path.join(root, `apps/web/messages/${locale}.json`)), true)
        const other = locale === 'en' ? 'ru' : 'en'
        assert.equal(existsSync(path.join(root, `apps/web/messages/${other}.json`)), false)
        const request = readFileSync(path.join(root, 'apps/web/src/i18n/request.ts'), 'utf8')
        assert.match(request, new RegExp(`messages/${locale}\\.json`))
        assert.doesNotMatch(request, /\bimport\s*\(/)
        const proxy = readFileSync(path.join(root, 'apps/web/src/proxy.ts'), 'utf8')
        assert.match(proxy, /NextResponse\.next\(\{\s*request: \{\s*headers: request\.headers/)
        assert.match(proxy, /Reporting-Endpoints/)
        assert.doesNotMatch(proxy, /next-intl|handleI18nRouting/)
      }))
  }
})
