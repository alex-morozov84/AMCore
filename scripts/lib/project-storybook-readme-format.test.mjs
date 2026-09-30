import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { resolveConfig, format } from 'prettier'

import { applyFilesystemTransaction } from './filesystem-transaction.mjs'
import { prepareProjectInit } from './project-init-plan.mjs'
import { createWorkingTreeCopy } from './working-tree-fixture.mjs'

for (const consoleDisabled of [false, true]) {
  test(`Storybook-disabled testing row stays formatted (Console disabled: ${consoleDisabled})`, async () => {
    const copy = createWorkingTreeCopy(process.cwd())
    try {
      const flags = { storybook: 'disabled', ...(consoleDisabled ? { 'admin-console': 'disabled' } : {}) }
      const plan = prepareProjectInit(copy.root, flags, 'admin')
      applyFilesystemTransaction({ root: copy.root, operations: plan.operationPlan.operationsForApply() })
      plan.assertApplied()
      const file = path.join(copy.root, 'README.md')
      const output = readFileSync(file, 'utf8')
      assert.doesNotMatch(output, /docs\/frontend\/storybook\.md/)
      assert.match(output, /docs\/product-admin\/README\.md/)
      const formatted = await format(output, { ...await resolveConfig(file), filepath: file })
      const row = (text) => text.split('\n').find((line) => line.startsWith('| Frontend testing '))
      assert.ok(row(output))
      assert.equal(row(output), row(formatted))
      if (!consoleDisabled) assert.equal(output, formatted)
    } finally {
      copy.cleanup()
    }
  })
}
