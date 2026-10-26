import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { applyFilesystemTransaction } from './filesystem-transaction.mjs'
import { prepareProjectInit } from './project-init-plan.mjs'
import { SCAFFOLD_COVERING_SCENARIOS } from './scaffold-covering-recipes.mjs'
import { createWorkingTreeCopy } from './working-tree-fixture.mjs'

const read = (root, file) => readFileSync(path.join(root, file), 'utf8')
const guide = 'docs/frontend/next-route-cache-patch.md'
const control = 'apps/web/src/shared/ui/locale-selector.tsx'
const marker = 'AMCORE_CONSOLE_ROUTE_CACHE_PATCH'

function apply(root, flags) {
  const plan = prepareProjectInit(root, flags, flags['admin-console-slug'] ?? 'admin')
  applyFilesystemTransaction({ root, operations: plan.operationPlan.operationsForApply() })
  plan.assertApplied()
}

for (const scenario of SCAFFOLD_COVERING_SCENARIOS) {
  test(`message boundaries and patch ownership: ${scenario.name}`, () => {
    const copy = createWorkingTreeCopy()
    try {
      const patch = read(copy.root, 'patches/next@16.4.2.patch')
      const flags = Object.fromEntries(
        scenario.flags.filter((x) => x.includes('=')).map((x) => x.slice(2).split('='))
      )
      apply(copy.root, flags)
      const single = scenario.factors.localeTopology === 'single'
      const consoleOff = scenario.factors.console === 'disabled'
      assert.equal(existsSync(path.join(copy.root, control)), !single)
      assert.match(read(copy.root, guide), /route-fragment\.spec\.ts/)
      assert.equal(read(copy.root, guide).includes('locale-url.spec.ts'), !single)
      assert.equal(
        read(copy.root, guide).includes('--lane console-real-stack -- locale-profile.spec.ts'),
        !single && !consoleOff
      )
      assert.equal(read(copy.root, 'patches/next@16.4.2.patch'), patch)
      assert.match(read(copy.root, 'pnpm-workspace.yaml'), /next@16\.4\.2/)
      assert.match(read(copy.root, 'apps/web/next.config.ts'), /tsconfig\.build\.json/)
      const layout = `apps/web/src/app/${single ? '' : '[locale]/'}layout.tsx`
      assert.match(read(copy.root, layout), /<RootClientMessages>/)
      if (single) {
        assert.equal(
          existsSync(path.join(copy.root, 'apps/web/e2e/shared/locale-switcher-journey.ts')),
          false
        )
        assert.match(read(copy.root, 'apps/web/src/i18n/request.ts'), /import 'server-only'/)
        assert.match(read(copy.root, 'apps/web/src/shared/ui/route-progress-bar.tsx'), /useLocale/)
        assert.doesNotMatch(
          read(copy.root, 'apps/web/src/shared/ui/route-progress-bar.test.tsx'),
          /it\('finishes a locale-only commit/
        )
      }
    } finally {
      copy.cleanup()
    }
  })
}

test('both dimensions remove the shared doc contribution once and retain unrelated text', () => {
  const copy = createWorkingTreeCopy()
  try {
    const file = path.join(copy.root, guide)
    writeFileSync(file, read(copy.root, guide) + '\n\n\nUnrelated sentinel.\n')
    apply(copy.root, { mode: 'single', locale: 'en', 'admin-console': 'disabled' })
    assert.doesNotMatch(read(copy.root, guide), /AMCORE_(?:LOCALE|CONSOLE)_ROUTE_CACHE_PATCH/)
    assert.match(read(copy.root, guide), /\n\n\nUnrelated sentinel\.\n$/)
  } finally {
    copy.cleanup()
  }
})

test('missing and duplicate owned doc markers fail before applying a plan', () => {
  const copy = createWorkingTreeCopy()
  try {
    const file = path.join(copy.root, guide)
    const original = read(copy.root, guide)
    for (const mutated of [
      original.replace(`<!-- ${marker}_START -->`, ''),
      original + `\n<!-- ${marker}_START -->\n`,
    ]) {
      writeFileSync(file, mutated)
      assert.throws(
        () => prepareProjectInit(copy.root, { mode: 'single', locale: 'en' }, 'admin'),
        /block|marker|seam|anchor/i
      )
      assert.equal(read(copy.root, guide), mutated)
      assert(existsSync(path.join(copy.root, control)))
    }
  } finally {
    copy.cleanup()
  }
})

test('multi-locale Console and Storybook removal retains the locale-only patch recipe', () => {
  const copy = createWorkingTreeCopy()
  try {
    apply(copy.root, { 'admin-console': 'disabled', storybook: 'disabled' })
    assert.equal(existsSync(path.join(copy.root, control)), true)
    assert.match(read(copy.root, guide), /locale-url\.spec\.ts/)
    assert.doesNotMatch(read(copy.root, guide), /AMCORE_CONSOLE_ROUTE_CACHE_PATCH/)
    assert.match(read(copy.root, guide), /route-fragment\.spec\.ts/)
  } finally {
    copy.cleanup()
  }
})
