import { operationsConsoleOwnership } from './operations-console-ownership.mjs'
import { validateOwnership } from './ownership-validate.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { symlinkSync, writeFileSync } from 'node:fs'
import { prepareProjectInit } from './project-init-plan.mjs'
import { applyFilesystemTransaction } from './filesystem-transaction.mjs'
import { createRealRepoCopy } from './test-fixture.mjs'
import { SCAFFOLD_COVERING_SCENARIOS } from './scaffold-covering-recipes.mjs'
import { parseProjectFlags } from './project-flags.mjs'
import { assertManagedStandProjection } from './scaffold-managed-stand-assertions.mjs'

for (const scenario of SCAFFOLD_COVERING_SCENARIOS)
  test(`managed runtime projects with ${scenario.name}`, async () => {
    const copy = createRealRepoCopy()
    try {
      const flags = parseProjectFlags(scenario.flags)
      const plan = prepareProjectInit(copy.root, flags, 'panel')
      applyFilesystemTransaction({
        root: copy.root,
        operations: plan.operationPlan.operationsForApply(),
      })
      plan.assertApplied()
      symlinkSync(`${process.cwd()}/node_modules`, `${copy.root}/node_modules`)
      await assertManagedStandProjection(copy.root, scenario)
    } finally {
      copy.cleanup()
    }
  })

test('a new managed helper importing Console verification requires ownership', () => {
  const copy = createRealRepoCopy()
  try {
    writeFileSync(
      `${copy.root}/scripts/stand/forgotten.test.mjs`,
      "import { proxySmoke } from './proxy-smoke.mjs'\n"
    )
    assert.throws(
      () => validateOwnership(copy.root, operationsConsoleOwnership),
      /forgotten\.test\.mjs.*proxy-smoke\.mjs/
    )
  } finally {
    copy.cleanup()
  }
})
