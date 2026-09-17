import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { OWNERSHIP_CODES, OwnershipError } from './ownership-errors.mjs'
import { buildProjectFactPlan } from './project-fact-plan.mjs'
import { validateProjectLocaleOwnership } from './project-locale-plan.mjs'
import { createRealRepoCopy } from './test-fixture.mjs'

const root = process.cwd()

function allSteps(plan) {
  return [
    ...plan.localeSteps,
    ...plan.sharedContentSteps,
    ...plan.storybookSteps,
    ...plan.consoleSteps,
  ]
}

function withCopy(run) {
  const copy = createRealRepoCopy()
  try {
    return run(copy.root)
  } finally {
    copy.cleanup()
  }
}

function write(rootPath, pathname, content) {
  const target = path.join(rootPath, pathname)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, content)
}

test('accepts EN and RU projected import graphs without exclusions', () => {
  for (const locale of ['en', 'ru']) {
    const plan = buildProjectFactPlan(root, { mode: 'single', locale }, 'admin')
    const selected = `apps/web/messages/${locale}.json`
    const removed = `apps/web/messages/${locale === 'en' ? 'ru' : 'en'}.json`
    assert.ok(plan.localeValidation.projection.universalSharedModules.has(selected))
    assert.ok(plan.localeValidation.projection.deadSharedModules.has(removed))
    assert.ok(
      plan.localeValidation.projection.universalSharedModules.has(
        'packages/shared/src/lib/frontend-url.ts'
      )
    )
    assert.ok(plan.localeValidation.projection.universalSharedModules.has('apps/web/src/proxy.ts'))
    assert.ok(!plan.localeValidation.projection.removed.has('apps/web/src/proxy.ts'))
  }
})

test('rejects treating the shared proxy framework entrypoint as locale-owned', () => {
  const plan = buildProjectFactPlan(root, { mode: 'single', locale: 'en' }, 'admin')
  const mutated = allSteps(plan).filter((step) => !step.target.endsWith('apps/web/src/proxy.ts'))
  assert.throws(
    () => validateProjectLocaleOwnership(root, mutated, 'en'),
    ownershipCode(OWNERSHIP_CODES.RESIDUAL)
  )
})

test('closed roots automatically own a newly nested locale-switcher file', () =>
  withCopy((copyRoot) => {
    const nested = 'apps/web/src/features/locale-switcher/nested/new-owned.ts'
    write(copyRoot, nested, 'export const nestedLocaleFeature = true\n')
    const plan = buildProjectFactPlan(copyRoot, { mode: 'single', locale: 'en' }, 'admin')
    const owned = plan.localeValidation.inventory.rootFiles.get(
      'apps/web/src/features/locale-switcher'
    )
    assert.ok(owned.includes(nested))
    assert.ok(plan.localeValidation.projection.removed.has(nested))
  }))

test('rejects an undeclared production contribution outside owned roots', () =>
  withCopy((copyRoot) => {
    write(
      copyRoot,
      'apps/web/src/shared/lib/rogue-locale.ts',
      "import { LocaleSwitcher } from '@/features/locale-switcher'\nexport { LocaleSwitcher }\n"
    )
    assert.throws(
      () => buildProjectFactPlan(copyRoot, { mode: 'single', locale: 'en' }, 'admin'),
      ownershipCode(OWNERSHIP_CODES.MISSING_SEAM)
    )
  }))

test('rejects a standalone locale-specific test outside the manifest', () =>
  withCopy((copyRoot) => {
    write(
      copyRoot,
      'apps/web/src/shared/lib/rogue-locale.test.ts',
      "import { LocaleSwitcher } from '@/features/locale-switcher'\nvoid LocaleSwitcher\n"
    )
    assert.throws(
      () => buildProjectFactPlan(copyRoot, { mode: 'single', locale: 'en' }, 'admin'),
      ownershipCode(OWNERSHIP_CODES.MISSING_SEAM)
    )
  }))

test('restoring the request dynamic import fails the general M3 contract', () => {
  const plan = buildProjectFactPlan(root, { mode: 'single', locale: 'en' }, 'admin')
  const requestPath = 'apps/web/src/i18n/request.ts'
  const original = readFileSync(path.join(root, requestPath), 'utf8')
  const mutated = allSteps(plan).map((step) =>
    step.target.endsWith(requestPath) ? { ...step, after: original } : step
  )
  assert.throws(
    () => validateProjectLocaleOwnership(root, mutated, 'en'),
    ownershipCode(OWNERSHIP_CODES.DYNAMIC_REFERENCE)
  )
})

test('rejects a mutation that restores an English RU default expectation', () => {
  const plan = buildProjectFactPlan(root, { mode: 'single', locale: 'ru' }, 'admin')
  const target = 'email-verification.integration.spec.ts'
  const mutated = allSteps(plan).map((step) =>
    step.target.endsWith(target)
      ? { ...step, after: step.after.replace("'24 часа'", "'24 hours'") }
      : step
  )
  assert.throws(
    () => validateProjectLocaleOwnership(root, mutated, 'ru'),
    ownershipCode(OWNERSHIP_CODES.RESIDUAL)
  )
})

test('rejects a mutation that restores an unsupported typed EN fixture', () => {
  const plan = buildProjectFactPlan(root, { mode: 'single', locale: 'ru' }, 'admin')
  const target = 'packages/shared/src/lib/frontend-url.test.ts'
  const mutated = allSteps(plan).map((step) =>
    step.target.endsWith(target)
      ? { ...step, after: step.after.replace("localePathPrefix('ru',", "localePathPrefix('en',") }
      : step
  )
  assert.throws(
    () => validateProjectLocaleOwnership(root, mutated, 'ru'),
    ownershipCode(OWNERSHIP_CODES.RESIDUAL)
  )
})

function ownershipCode(code) {
  return (error) => error instanceof OwnershipError && error.code === code
}
