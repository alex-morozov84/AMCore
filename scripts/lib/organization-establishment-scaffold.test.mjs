import assert from 'node:assert/strict'
import { readFileSync, symlinkSync } from 'node:fs'
import { test } from 'node:test'

import {
  applyStructuralPlan,
  planStructuralComposition,
} from './path-algebra-structural-compose.mjs'
import { createProjectStructuralRegistry } from './project-content-materializer.mjs'
import { prepareProjectInit } from './project-init-plan.mjs'
import { applyFilesystemTransaction } from './filesystem-transaction.mjs'
import { createWorkingTreeCopy } from './working-tree-fixture.mjs'
import { assertManagedStandProjection } from './scaffold-managed-stand-assertions.mjs'

const story = 'apps/web/src/features/console-organization-setup/ui/organization-setup.stories.tsx'

function projectCatalogue(locale, source) {
  const registry = createProjectStructuralRegistry()
  const [plan] = planStructuralComposition(registry, [
    {
      kind: 'structural',
      dimension: 'locale',
      path: story,
      operationKey: 'locale.catalogue-fixture',
      params: { locale, variant: 'catalogue-pair' },
    },
  ])
  return applyStructuralPlan(registry, plan, source)
}

for (const locale of ['en', 'ru']) {
  test(`catalogue pair selects ${locale} without losing unrelated code or story assertions`, () => {
    const source = readFileSync(story, 'utf8')
    const sentinel = "\nexport const unrelated = 'keep-this-source'\n"
    const result = projectCatalogue(locale, source + sentinel)
    assert.equal(
      result,
      (source + sentinel)
        .replaceAll('messages/en.json', `messages/${locale}.json`)
        .replaceAll('messages/ru.json', `messages/${locale}.json`)
    )
    assert.match(result, /export const RecipientUnavailableRussian/)
    assert.match(result, /russian\.console\.organizationSetup/)
  })
  test(`single-${locale} with Console retained projects both new story catalogues`, () => {
    const copy = createWorkingTreeCopy()
    try {
      const plan = prepareProjectInit(copy.root, { mode: 'single', locale }, 'admin')
      applyFilesystemTransaction({
        root: copy.root,
        operations: plan.operationPlan.operationsForApply(),
      })
      plan.assertApplied()
      for (const path of [
        story,
        'apps/web/src/features/organization-create/ui/organization-create.stories.tsx',
        'apps/web/src/shared/ui/role-checklist.test.tsx',
        'apps/web/src/shared/ui/role-checklist.stories.tsx',
      ]) {
        const result = readFileSync(`${copy.root}/${path}`, 'utf8')
        assert.ok(result.includes(`messages/${locale}.json`))
        assert.ok(!result.includes(`messages/${locale === 'en' ? 'ru' : 'en'}.json`))
      }
    } finally {
      copy.cleanup()
    }
  })
}

test('catalogue pair refuses a missing or duplicate catalogue before changing source', () => {
  const source = readFileSync(story, 'utf8')
  assert.throws(
    () =>
      projectCatalogue(
        'ru',
        source.replace("import russian from '../../../../messages/ru.json'", '')
      ),
    /missing or ambiguous/
  )
  assert.throws(
    () =>
      projectCatalogue('en', source + "\nimport duplicate from '../../../../messages/ru.json'\n"),
    /missing or ambiguous/
  )
})

test('single-ru Console removal keeps setup CLI lane and localized preview labels', async () => {
  const copy = createWorkingTreeCopy()
  try {
    const plan = prepareProjectInit(
      copy.root,
      { mode: 'single', locale: 'ru', 'admin-console': 'disabled', storybook: 'disabled' },
      'admin'
    )
    applyFilesystemTransaction({
      root: copy.root,
      operations: plan.operationPlan.operationsForApply(),
    })
    plan.assertApplied()
    symlinkSync(`${process.cwd()}/node_modules`, `${copy.root}/node_modules`, 'dir')
    await assertManagedStandProjection(copy.root, {
      factors: { console: 'disabled', locales: ['ru'] },
    })
  } finally {
    copy.cleanup()
  }
})
