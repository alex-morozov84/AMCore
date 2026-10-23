import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { applyFilesystemTransaction } from './filesystem-transaction.mjs'
import { prepareProjectInit } from './project-init-plan.mjs'
import { createWorkingTreeCopy } from './working-tree-fixture.mjs'

const pathname = 'apps/web/src/shared/ui/alert.stories.tsx'

for (const locale of ['en', 'ru']) {
  for (const disabled of [false, true]) {
    test(`Alert story survives single-${locale}, Storybook disabled: ${disabled}`, () => {
      const copy = createWorkingTreeCopy(process.cwd())
      try {
        const plan = prepareProjectInit(
          copy.root,
          { mode: 'single', locale, ...(disabled ? { storybook: 'disabled' } : {}) },
          'admin'
        )
        applyFilesystemTransaction({
          root: copy.root,
          operations: plan.operationPlan.operationsForApply(),
        })
        plan.assertApplied()
        const target = path.join(copy.root, pathname)
        assert.equal(existsSync(target), !disabled)
        if (disabled) return
        const story = readFileSync(target, 'utf8')
        const imports = [...story.matchAll(/messages\/(en|ru)\.json/g)].map((match) => match[1])
        assert.deepEqual(imports, [locale, locale])
        const catalogue = JSON.parse(
          readFileSync(path.join(copy.root, `apps/web/messages/${locale}.json`), 'utf8')
        )
        assert.equal(typeof catalogue.common.close, 'string')
        assert.match(story, /closeLabel=\{previewMessages\.ru\.common\.close\}/)
        assert.match(story, /dismissFocusTargetId="preview-alert-destination"/)
        assert.match(story, /export const DismissiblePreview/)
      } finally {
        copy.cleanup()
      }
    })
  }
}
