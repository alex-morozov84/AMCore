import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { resolveConfig, format } from 'prettier'

import { applyFilesystemTransaction } from './filesystem-transaction.mjs'
import { prepareProjectInit } from './project-init-plan.mjs'
import { createWorkingTreeCopy } from './working-tree-fixture.mjs'

for (const [consoleDisabled, storybookDisabled] of [
  [false, false],
  [false, true],
  [true, false],
  [true, true],
]) {
  test(`Generated README stays formatted (Console disabled: ${consoleDisabled}, Storybook disabled: ${storybookDisabled})`, async () => {
    const copy = createWorkingTreeCopy(process.cwd())
    try {
      const flags = {
        ...(storybookDisabled ? { storybook: 'disabled' } : {}),
        ...(consoleDisabled ? { 'admin-console': 'disabled' } : {}),
      }
      const plan = prepareProjectInit(copy.root, flags, 'admin')
      if (consoleDisabled || storybookDisabled)
        applyFilesystemTransaction({
          root: copy.root,
          operations: plan.operationPlan.operationsForApply(),
        })
      plan.assertApplied()
      const source = readFileSync(path.join(process.cwd(), 'README.md'), 'utf8')
      const sourceCells = source
        .split('\n')
        .filter((line) => line.startsWith('|'))
        .filter(
          (line) =>
            !/Operations Console|operations-console|Storybook|Component workshop/.test(line) &&
            !/^\| [- ]+\|/.test(line) &&
            !(storybookDisabled && /Accessibility|Frontend testing/.test(line))
        )
        .map((line) => line.replace(/ +\|/g, '|'))
      const file = path.join(copy.root, 'README.md')
      const output = readFileSync(file, 'utf8')
      if (storybookDisabled) assert.doesNotMatch(output, /docs\/frontend\/storybook\.md/)
      if (consoleDisabled) assert.doesNotMatch(output, /docs\/operations-console\/README\.md/)
      assert.match(output, /docs\/product-admin\/README\.md/)
      const outputCells = output
        .split('\n')
        .filter((line) => line.startsWith('|'))
        .map((line) => line.replace(/ +\|/g, '|'))
      for (const cell of sourceCells) assert.ok(outputCells.includes(cell), cell)
      const formatted = await format(output, { ...(await resolveConfig(file)), filepath: file })
      const row = (text) => text.split('\n').find((line) => line.startsWith('| Frontend testing '))
      assert.ok(row(output))
      assert.equal(row(output), row(formatted))
      assert.equal(output, formatted)
    } finally {
      copy.cleanup()
    }
  })
}
