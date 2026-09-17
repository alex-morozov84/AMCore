import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, test } from 'node:test'

import { prepareBrandInit } from './brand-init-plan.mjs'
import { applyFilesystemTransaction } from './filesystem-transaction.mjs'
import { createFixtureRepo } from './test-fixture.mjs'

let fixture
afterEach(() => fixture?.cleanup())

const read = (relative) => readFileSync(path.join(fixture.root, relative), 'utf8')

test('full initial answers have exact current-tree output', () => {
  fixture = createFixtureRepo()
  const { operationPlan } = prepareBrandInit(fixture.root, {
    productName: "Bob's App",
    productDescription: 'A new tagline.',
    purpose: 'Ship Acme things.',
    upstreamSyncPolicy: 'Rebase quarterly.',
    workflowMode: 'flexible',
    themeMode: 'dark',
    themePersistence: 'cookie-ssr',
    packageName: 'bobs-app',
    amcoreVersion: 'v0.9.0',
  })
  applyFilesystemTransaction({ root: fixture.root, operations: operationPlan.operationsForApply() })
  assert.equal(
    read('PROJECT_CONTEXT.md'),
    [
      '# Project Context',
      '',
      '## Identity',
      '',
      '- **Mode:** `downstream-product`',
      "- **Product:** Bob's App",
      '- **Purpose:** Ship Acme things.',
      '- **Canonical upstream:** https://github.com/example/amcore',
      '- **Upstream sync policy:** Rebase quarterly.',
      '- **Workflow mode:** `flexible` — see "Workflow Modes" below.',
      '- **theme_persistence:** cookie-ssr',
      '- **initialized_from_amcore_version:** v0.9.0',
      '',
    ].join('\n')
  )
  assert.deepEqual(JSON.parse(read('package.json')), {
    name: 'bobs-app',
    version: '0.1.0',
    description: 'A new tagline.',
  })
  assert.equal(
    read('apps/web/src/app/manifest.ts'),
    [
      'export default function manifest() {',
      '  return {',
      "    name: 'Bob\\'s App',",
      "    short_name: 'Bob\\'s App',",
      "    description: 'A new tagline.',",
      '  }',
      '}',
      '',
    ].join('\n')
  )
  assert.equal(JSON.parse(read('apps/web/messages/en.json')).meta.title, "Bob's App")
  assert.equal(JSON.parse(read('apps/web/messages/ru.json')).meta.description, 'Стартовый шаблон.')
  assert.equal(
    read('apps/web/src/shared/lib/theme.ts'),
    "export const DEFAULT_THEME_SETTING: ThemeSetting = 'dark'\n"
  )
})
